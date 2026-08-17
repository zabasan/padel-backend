import type User from '#models/user'
import { resolvePermissionsForUser } from '#services/permissions'

/**
 * Single serializer for every payload that represents "the logged-in user"
 * — login, profile, signup, and the guest-to-customer upgrade. Missing any
 * one of the four call sites leaves that flow's permissions empty until the
 * next /account/profile refetch (AuthContext.jsx refetches on mount, so it
 * self-heals on reload only — exactly the class of bug that ships).
 */
export async function serializeSessionUser(user: User) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roleId: user.roleId ?? null,
    phone: user.phone,
    hasLoggedIn: Boolean(user.hasLoggedIn),
    isSuperUser: Boolean(user.isSuperUser),
    permissions: await resolvePermissionsForUser(user),
  }
}
