import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface AuthUser {
  sub: string
  employee_id: string
  name: string
  role: string
  is_admin: boolean
  team_id: number | null
  staff_id: number | null
  exp: number
}

interface AuthContextType {
  user:      AuthUser | null
  token:     string | null
  isLoading: boolean
  login:     (token: string) => void
  logout:    () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null, token: null, isLoading: true,
  login: () => {}, logout: () => {},
})

function decodeToken(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (payload.exp * 1000 < Date.now()) return null   // expired
    return payload as AuthUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token,     setToken]     = useState<string | null>(null)
  const [user,      setUser]      = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('gtr_token')
    if (stored) {
      const decoded = decodeToken(stored)
      if (decoded) { setToken(stored); setUser(decoded) }
      else { localStorage.removeItem('gtr_token') }
    }
    setIsLoading(false)
  }, [])

  function login(newToken: string) {
    const decoded = decodeToken(newToken)
    if (!decoded) return
    localStorage.setItem('gtr_token', newToken)
    setToken(newToken)
    setUser(decoded)
  }

  function logout() {
    localStorage.removeItem('gtr_token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
