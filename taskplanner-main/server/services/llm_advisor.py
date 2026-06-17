"""LLM-based impact advisor for flight changes.

Uses Claude to analyse assignment conflicts after a flight time or bay change
and recommend whether to trigger a Timefold replan for upcoming turnarounds.

Requires ANTHROPIC_API_KEY env var.  Falls back to rule-based logic if the key
is absent or the API call fails.
"""
import json
import os


def analyze_impact(
    flight: dict,
    conflicts: list[dict],
    current_time_str: str,
    upcoming_count: int,
) -> dict:
    """Return {should_replan, reason, urgency} by consulting Claude.

    flight:         dict with flight_number, direction, aircraft_registration,
                    scheduled_time, estimated_time, bay
    conflicts:      list of {staff_name, conflict_type, description}
    current_time_str: "HH:MM"
    upcoming_count: number of turnarounds with STA > current time
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _rule_based(conflicts)

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)

        old_time = flight.get("_old_scheduled_time") or flight.get("scheduled_time", "?")
        new_time = flight.get("estimated_time") or flight.get("scheduled_time", "?")
        old_bay  = flight.get("_old_bay", "?")
        new_bay  = flight.get("bay", "?")

        conflict_text = (
            "\n".join(
                f"  • {c['staff_name']} — {c['conflict_type'].replace('_',' ')}: {c['description']}"
                for c in conflicts
            ) if conflicts else "  None"
        )

        prompt = f"""You are an airline ground operations manager AI at KLIA T2 NB terminal.

A flight has been updated:
  Flight:    {flight.get('flight_number', '?')} ({flight.get('direction', '?')})
  Aircraft:  {flight.get('aircraft_registration', '?')}
  Time:      {old_time} → {new_time}
  Bay:       {old_bay} → {new_bay}
  Current time: {current_time_str}

Staff assignment conflicts detected ({len(conflicts)} total):
{conflict_text}

Upcoming unstarted turnarounds that could be replanned: {upcoming_count}

Should the system trigger a full AI replan of upcoming flight assignments?
Consider: severity of conflicts, number of staff affected, lead time before affected flights, disruption from replanning.

Respond ONLY with valid JSON — no markdown, no extra text:
{{"should_replan": true, "reason": "one concise sentence", "urgency": "high"}}

urgency must be "high", "medium", or "low"."""

        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        result = json.loads(text)
        # Validate keys
        return {
            "should_replan": bool(result.get("should_replan", False)),
            "reason": str(result.get("reason", "No reason provided.")),
            "urgency": str(result.get("urgency", "medium")),
        }

    except Exception as exc:
        print(f"[llm-advisor] API call failed ({exc}), using rule-based fallback.")
        return _rule_based(conflicts)


def summarize_plan(
    team_id: int,
    date: str,
    total_slots: int,
    unassigned: int,
    conflicts: list[dict],
    retried: bool,
) -> str:
    """One/two sentence plain-English explanation of a completed Timefold solve
    — why slots are unassigned or conflicts remain (e.g. certification/staffing
    shortage vs. solver time limit). Falls back to a rule-based summary if no
    API key or the call fails. NOTE: this only explains the result — it does
    not and cannot retune Timefold's constraint weights at runtime; the actual
    corrective action (the bounded auto-retry with more solve time) happens
    in task_solver_manager.py before this is even called.
    """
    if unassigned == 0 and not conflicts:
        return f"All {total_slots} slots filled with no conflicts."

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _rule_based_summary(total_slots, unassigned, conflicts, retried)

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)

        conflict_text = (
            "\n".join(f"  • {c['staff_name']} — {c['conflict_type']}: {c['description']}" for c in conflicts)
            if conflicts else "  None"
        )
        prompt = f"""You are an airline ground operations manager AI at KLIA T2 NB terminal.

A Timefold AI solve just completed for team {team_id}, date {date}:
  Total role slots: {total_slots}
  Unassigned slots: {unassigned}
  Auto-retried with more solve time: {retried}
  Remaining conflicts:
{conflict_text}

In 1-2 concise sentences, explain the most likely root cause to a ramp ops
manager (e.g. insufficient certified/on-duty staff for the demand, vs. the
solver running out of time) and what they should do about it.
Respond with plain text only — no markdown."""

        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception as exc:
        print(f"[llm-advisor] summarize_plan failed ({exc}), using rule-based fallback.")
        return _rule_based_summary(total_slots, unassigned, conflicts, retried)


def _rule_based_summary(total_slots: int, unassigned: int, conflicts: list[dict], retried: bool) -> str:
    if conflicts:
        kinds = sorted({c["conflict_type"] for c in conflicts})
        return (
            f"{len(conflicts)} conflict(s) ({', '.join(kinds)}) remained after "
            f"{'a retry' if retried else 'solving'} — the solver couldn't reach a fully "
            f"feasible solution in time. Consider re-running with more time or fewer flights."
        )
    pct = round(100 * unassigned / total_slots) if total_slots else 0
    return (
        f"{unassigned} of {total_slots} slots ({pct}%) are unassigned — most likely not enough "
        f"certified/on-duty staff for the demand in this shift window, not a solver failure."
    )


def _rule_based(conflicts: list[dict]) -> dict:
    """Fallback: rule-based heuristic when LLM is unavailable."""
    double_bookings = [c for c in conflicts if c.get("conflict_type") == "double_booking"]
    travel_gaps     = [c for c in conflicts if c.get("conflict_type") == "travel_gap"]

    if double_bookings:
        return {
            "should_replan": True,
            "reason": f"{len(double_bookings)} staff double-booked — replan required to resolve hard conflicts.",
            "urgency": "high",
        }
    if len(travel_gaps) > 3:
        return {
            "should_replan": True,
            "reason": f"{len(travel_gaps)} staff have insufficient travel time — replan recommended.",
            "urgency": "medium",
        }
    if travel_gaps:
        return {
            "should_replan": False,
            "reason": f"{len(travel_gaps)} minor travel gap issue(s) — team leader can adjust manually.",
            "urgency": "low",
        }
    return {
        "should_replan": False,
        "reason": "No significant conflicts detected — current plan remains valid.",
        "urgency": "low",
    }
