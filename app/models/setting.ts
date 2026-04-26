import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Setting extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare key: string

  @column()
  declare value: string | null
}
