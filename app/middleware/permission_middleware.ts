import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { can, getRequestPermissions, type PermissionAction } from '#services/permissions'

/**
 * Registered ALONGSIDE role_middleware during the rollout (kernel.ts), not
 * as a replacement — a route group can carry both, and Adonis runs them in
 * order (AND semantics, strictest wins). That is what makes the group-by-
 * group cutover in the plan safe to deploy and to revert.
 *
 * Failure response is byte-identical to role_middleware's, on purpose: every
 * frontend page already toasts err.response?.data?.message, and changing
 * the shape would ripple through all of them. `module`/`action` are never
 * echoed back to an unauthorized caller.
 */
export interface PermissionRequirement {
  module: string
  action?: PermissionAction
}

export default class PermissionMiddleware {
  /**
   * `or` habilita una alternativa: cumplir CUALQUIERA de los dos pares deja pasar.
   *
   * Existe para los endpoints que alimentan más de una pantalla. El listado de roles es el
   * caso: es del ABM de Roles (`roles.view`), pero los <select> de Rol de la pantalla de
   * Usuarios también lo necesitan, y quien administra usuarios no tiene por qué tener acceso
   * al ABM. Sin el OR, dar de alta un usuario sin `roles.view` sería imposible: el desplegable
   * llegaría vacío.
   *
   * Esto NO afecta el `AND` entre middlewares apilados — dos `.use(permission(...))` sobre la
   * misma ruta siguen exigiéndose los dos.
   */
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: PermissionRequirement & { or?: PermissionRequirement }
  ) {
    if (!ctx.auth.user) {
      return ctx.response.unauthorized({ message: 'No autenticado' })
    }

    const perms = await getRequestPermissions(ctx)
    const satisfies = (req: PermissionRequirement) =>
      can(perms, req.module, req.action ?? 'view')

    if (!satisfies(options) && !(options.or && satisfies(options.or))) {
      return ctx.response.forbidden({ message: 'Acceso denegado: permisos insuficientes' })
    }

    return next()
  }
}
