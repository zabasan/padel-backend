import type { HttpContext } from '@adonisjs/core/http'
import Setting from '#models/setting'

export default class SettingsController {
  async show({ response }: HttpContext) {
    const rows = await Setting.all()
    const result: Record<string, string | null> = {}
    for (const row of rows) result[row.key] = row.value
    return response.ok({
      appTitle: result['appTitle'] ?? 'Padel Complex',
      appLogo: result['appLogo'] ?? null,
      colorPalette: result['colorPalette'] ?? 'green',
      contactMessage: result['contactMessage'] ?? '',
      complexPhone: result['complexPhone'] ?? '',
    })
  }

  async update({ request, response }: HttpContext) {
    const { appTitle, appLogo, colorPalette, contactMessage, complexPhone } = request.only(['appTitle', 'appLogo', 'colorPalette', 'contactMessage', 'complexPhone'])

    await Setting.updateOrCreate({ key: 'appTitle' }, { key: 'appTitle', value: appTitle ?? 'Padel Complex' })
    await Setting.updateOrCreate({ key: 'appLogo' }, { key: 'appLogo', value: appLogo ?? null })
    await Setting.updateOrCreate({ key: 'colorPalette' }, { key: 'colorPalette', value: colorPalette ?? 'green' })
    await Setting.updateOrCreate({ key: 'contactMessage' }, { key: 'contactMessage', value: contactMessage ?? '' })
    await Setting.updateOrCreate({ key: 'complexPhone' }, { key: 'complexPhone', value: complexPhone ?? '' })

    return response.ok({
      appTitle: appTitle ?? 'Padel Complex',
      appLogo: appLogo ?? null,
      colorPalette: colorPalette ?? 'green',
      contactMessage: contactMessage ?? '',
      complexPhone: complexPhone ?? '',
    })
  }
}
