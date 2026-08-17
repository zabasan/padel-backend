import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createBareRole, createUserWithPermissions } from './fixtures.js'

/**
 * The rule is about PERMISSIONS, so the actors are built from permissions.
 *
 * `weakStaff` can reach every users route it needs (view + update) and holds nothing
 * else. `powerfulUser` holds all of that PLUS extras, making it a strict superset —
 * which is the only thing `assertCanActOnUser` actually compares.
 *
 * Written with `worker` and `admin` before, these tests silently depended on worker
 * staying weaker than admin in the seeded matrix. Granting worker more through the
 * Roles ABM (a supported action) flipped the comparison and turned the whole group
 * red, even though the guard was working exactly as designed.
 */
const createWeakStaff = () => createUserWithPermissions({ users: { view: true, update: true } })

const createPowerfulUser = () =>
  createUserWithPermissions({
    users: { view: true, update: true },
    stats: { view: true },
    settings: { view: true, update: true },
  })

/**
 * Red de regresión de la escalada de privilegios entre usuarios.
 *
 * El agujero original: `users_controller.update()` validaba el rol que se ASIGNA (D7) pero
 * nunca a QUIÉN se estaba editando. Como `worker` tiene `users.update`, un empleado podía
 * mandar `PUT /users/<id-del-admin> { password }` y quedarse con la cuenta del administrador.
 * Verificado en vivo antes del arreglo: HTTP 200 y login exitoso como admin.
 *
 * Mismo agujero en `resetLogin` (deja la contraseña igual al teléfono, que es público),
 * `toggleStatus` y `destroy`; y la variante de fuga en `show`/`search`, donde el listado
 * filtraba pero el detalle y el buscador no.
 */
test.group('escalada de privilegios entre usuarios', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('no se le puede cambiar la contraseña a alguien con más permisos', async ({ client }) => {
    const weakStaff = await createWeakStaff()
    const powerful = await createPowerfulUser()

    const response = await client
      .put(`/api/v1/users/${powerful.id}`)
      .loginAs(weakStaff)
      .json({ password: 'tomada-por-el-empleado' })

    response.assertStatus(403)
    response.assertBodyContains({
      message: 'No podés modificar a un usuario con más permisos que los tuyos',
    })
  })

  test('no se le puede resetear el acceso a alguien con más permisos', async ({ client }) => {
    const weakStaff = await createWeakStaff()
    const powerful = await createPowerfulUser()

    const response = await client
      .post(`/api/v1/users/${powerful.id}/reset-login`)
      .loginAs(weakStaff)
      .json({})
    response.assertStatus(403)
  })

  /**
   * Estas dos cubren la fuga por visibilidad, que es una regla distinta a la de arriba:
   * quien no tiene `users.erase` solo ve clientes y profesores (SELF_SERVICE_ROLES en
   * users_controller). El target va sobre un rol propio justamente por eso — cualquier
   * rol que no sea de autogestión tiene que quedar oculto, no solo el de admin.
   */
  test('sin users.erase no se ve por id la ficha de un rol que no es de autogestión', async ({
    client,
  }) => {
    const weakStaff = await createWeakStaff()
    const hidden = await createUserWithPermissions()

    const response = await client.get(`/api/v1/users/${hidden.id}`).loginAs(weakStaff)
    response.assertStatus(404)
  })

  test('sin users.erase el buscador no devuelve roles que no son de autogestión', async ({
    client,
    assert,
  }) => {
    const weakStaff = await createWeakStaff()
    const hiddenRole = await createBareRole()
    const hidden = await createUserWithPermissions({}, { role: hiddenRole })

    const response = await client
      .get(`/api/v1/users/search?q=${encodeURIComponent(hidden.fullName ?? 'Fixture')}`)
      .loginAs(weakStaff)

    response.assertStatus(200)
    const found = response.body() as { role: string }[]
    assert.isEmpty(
      found.filter((u) => u.role === hiddenRole.name),
      'el buscador expuso una cuenta de un rol que no es de autogestión'
    )
  })

  // El target no puede ser un `customer`: su rol trae courts.view y reservations.vcue,
  // que weakStaff NO tiene, así que el 403 sería correcto y el test no probaría nada.
  // "Menos permisos" tiene que significar exactamente eso.
  test('SÍ se puede editar a alguien con menos permisos — la regla no bloquea de más', async ({
    client,
  }) => {
    const weakStaff = await createWeakStaff()
    const weaker = await createUserWithPermissions()

    const response = await client
      .put(`/api/v1/users/${weaker.id}`)
      .loginAs(weakStaff)
      .json({ fullName: 'Editado Por Alguien Con Más Permisos' })

    response.assertStatus(200)
    response.assertBodyContains({ fullName: 'Editado Por Alguien Con Más Permisos' })
  })

  test('se puede editar a un par con los mismos permisos — mismo nivel, no es escalada', async ({
    client,
  }) => {
    const one = await createPowerfulUser()
    const peer = await createPowerfulUser()

    const response = await client
      .put(`/api/v1/users/${peer.id}`)
      .loginAs(one)
      .json({ fullName: 'Par Editado Por Par' })

    response.assertStatus(200)
  })

  test('cualquiera puede editarse a sí mismo', async ({ client }) => {
    const weakStaff = await createWeakStaff()

    const response = await client
      .put(`/api/v1/users/${weakStaff.id}`)
      .loginAs(weakStaff)
      .json({ fullName: 'Me Edito A Mi Mismo' })

    response.assertStatus(200)
  })
})
