import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createAdmin, createWorker, createCustomer } from './fixtures.js'

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

  test('un empleado NO puede cambiarle la contraseña a un administrador', async ({ client }) => {
    const worker = await createWorker()
    const admin = await createAdmin()

    const response = await client
      .put(`/api/v1/users/${admin.id}`)
      .loginAs(worker)
      .json({ password: 'tomada-por-el-empleado' })

    response.assertStatus(403)
    response.assertBodyContains({ message: 'No podés modificar a un usuario con más permisos que los tuyos' })
  })

  test('un empleado NO puede resetearle el acceso a un administrador', async ({ client }) => {
    const worker = await createWorker()
    const admin = await createAdmin()

    const response = await client.post(`/api/v1/users/${admin.id}/reset-login`).loginAs(worker).json({})
    response.assertStatus(403)
  })

  test('un empleado NO ve la ficha de un administrador por id', async ({ client }) => {
    const worker = await createWorker()
    const admin = await createAdmin()

    const response = await client.get(`/api/v1/users/${admin.id}`).loginAs(worker)
    response.assertStatus(404)
  })

  test('el buscador no le devuelve administradores a un empleado', async ({ client, assert }) => {
    const worker = await createWorker()
    const admin = await createAdmin()

    const response = await client
      .get(`/api/v1/users/search?q=${encodeURIComponent(admin.fullName ?? 'Admin')}`)
      .loginAs(worker)

    response.assertStatus(200)
    const found = response.body() as { role: string }[]
    assert.isEmpty(
      found.filter((u) => u.role === 'admin'),
      'el buscador expuso una cuenta de administrador a un empleado'
    )
  })

  test('un empleado SÍ puede editar a un cliente — la regla no bloquea de más', async ({ client }) => {
    const worker = await createWorker()
    const customer = await createCustomer()

    const response = await client
      .put(`/api/v1/users/${customer.id}`)
      .loginAs(worker)
      .json({ fullName: 'Cliente Editado Por Empleado' })

    response.assertStatus(200)
    response.assertBodyContains({ fullName: 'Cliente Editado Por Empleado' })
  })

  test('un admin puede editar a otro admin — mismo nivel, no es escalada', async ({ client }) => {
    const admin = await createAdmin()
    const other = await createAdmin()

    const response = await client
      .put(`/api/v1/users/${other.id}`)
      .loginAs(admin)
      .json({ fullName: 'Admin Editado Por Admin' })

    response.assertStatus(200)
  })

  test('cualquiera puede editarse a sí mismo', async ({ client }) => {
    const worker = await createWorker()

    const response = await client
      .put(`/api/v1/users/${worker.id}`)
      .loginAs(worker)
      .json({ fullName: 'Me Edito A Mi Mismo' })

    response.assertStatus(200)
  })
})
