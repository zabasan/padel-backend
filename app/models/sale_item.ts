import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Product from '#models/product'
import Sale from '#models/sale'

export default class SaleItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare saleId: number

  @column()
  declare productId: number | null

  /** Snapshot — the product may be renamed or retired later. */
  @column()
  declare productName: string

  @column({ consume: (v) => Number(v) })
  declare unitPrice: number

  @column({ consume: (v) => Number(v) })
  declare unitCost: number

  @column({ consume: (v) => Number(v) })
  declare quantity: number

  @column({ consume: (v) => Number(v) })
  declare subtotal: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Sale)
  declare sale: BelongsTo<typeof Sale>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
