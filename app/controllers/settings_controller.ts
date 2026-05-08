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
      defaultDepositPercentage: result['defaultDepositPercentage'] != null ? Number(result['defaultDepositPercentage']) : 30,
      recurringPromoEnabled: result['recurringPromoEnabled'] === 'true',
      recurringPromoGames: result['recurringPromoGames'] != null ? Number(result['recurringPromoGames']) : 9,
      recurringPromoFreeGames: result['recurringPromoFreeGames'] != null ? Number(result['recurringPromoFreeGames']) : 1,
      professorStartHour: result['professorStartHour'] != null ? Number(result['professorStartHour']) : 8,
      professorEndHour: result['professorEndHour'] != null ? Number(result['professorEndHour']) : 18,
      professorPadelPrice: result['professorPadelPrice'] != null ? Number(result['professorPadelPrice']) : null,
    })
  }

  async update({ request, response }: HttpContext) {
    const {
      appTitle, appLogo, colorPalette, contactMessage, complexPhone,
      defaultDepositPercentage, recurringPromoEnabled, recurringPromoGames, recurringPromoFreeGames,
      professorStartHour, professorEndHour, professorPadelPrice
    } = request.only([
      'appTitle', 'appLogo', 'colorPalette', 'contactMessage', 'complexPhone',
      'defaultDepositPercentage', 'recurringPromoEnabled', 'recurringPromoGames', 'recurringPromoFreeGames',
      'professorStartHour', 'professorEndHour', 'professorPadelPrice'
    ])

    await Setting.updateOrCreate({ key: 'appTitle' }, { key: 'appTitle', value: appTitle ?? 'Padel Complex' })
    await Setting.updateOrCreate({ key: 'appLogo' }, { key: 'appLogo', value: appLogo ?? null })
    await Setting.updateOrCreate({ key: 'colorPalette' }, { key: 'colorPalette', value: colorPalette ?? 'green' })
    await Setting.updateOrCreate({ key: 'contactMessage' }, { key: 'contactMessage', value: contactMessage ?? '' })
    await Setting.updateOrCreate({ key: 'complexPhone' }, { key: 'complexPhone', value: complexPhone ?? '' })
    await Setting.updateOrCreate({ key: 'defaultDepositPercentage' }, { key: 'defaultDepositPercentage', value: String(defaultDepositPercentage ?? 30) })
    await Setting.updateOrCreate({ key: 'recurringPromoEnabled' }, { key: 'recurringPromoEnabled', value: recurringPromoEnabled ? 'true' : 'false' })
    await Setting.updateOrCreate({ key: 'recurringPromoGames' }, { key: 'recurringPromoGames', value: String(recurringPromoGames ?? 9) })
    await Setting.updateOrCreate({ key: 'recurringPromoFreeGames' }, { key: 'recurringPromoFreeGames', value: String(recurringPromoFreeGames ?? 1) })
    await Setting.updateOrCreate({ key: 'professorStartHour' }, { key: 'professorStartHour', value: String(professorStartHour ?? 8) })
    await Setting.updateOrCreate({ key: 'professorEndHour' }, { key: 'professorEndHour', value: String(professorEndHour ?? 18) })
    await Setting.updateOrCreate({ key: 'professorPadelPrice' }, { key: 'professorPadelPrice', value: professorPadelPrice != null && professorPadelPrice !== '' ? String(professorPadelPrice) : '' })

    return response.ok({
      appTitle: appTitle ?? 'Padel Complex',
      appLogo: appLogo ?? null,
      colorPalette: colorPalette ?? 'green',
      contactMessage: contactMessage ?? '',
      complexPhone: complexPhone ?? '',
      defaultDepositPercentage: defaultDepositPercentage != null ? Number(defaultDepositPercentage) : 30,
      recurringPromoEnabled: Boolean(recurringPromoEnabled),
      recurringPromoGames: recurringPromoGames != null ? Number(recurringPromoGames) : 9,
      recurringPromoFreeGames: recurringPromoFreeGames != null ? Number(recurringPromoFreeGames) : 1,
      professorStartHour: professorStartHour != null ? Number(professorStartHour) : 8,
      professorEndHour: professorEndHour != null ? Number(professorEndHour) : 18,
      professorPadelPrice: professorPadelPrice != null && professorPadelPrice !== '' ? Number(professorPadelPrice) : null,
    })
  }
}
