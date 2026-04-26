import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import Court from '#models/court'
import CourtPriceRange from '#models/court_price_range'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  async run() {
    // Create admin user
    await User.updateOrCreate(
      { email: 'admin@padel.com' },
      {
        fullName: 'Administrador',
        email: 'admin@padel.com',
        phone: '1100000001',
        password: await hash.make('admin123'),
        role: 'admin',
      }
    )

    // Create worker user
    await User.updateOrCreate(
      { email: 'worker@padel.com' },
      {
        fullName: 'Empleado Principal',
        email: 'worker@padel.com',
        phone: '1100000002',
        password: await hash.make('worker123'),
        role: 'worker',
      }
    )

    // Create 3 padel courts
    const padelCourts = [
      { name: 'Cancha Padel 1', type: 'padel' as const, description: 'Cancha de pádel con césped artificial', pricePerHour: 2000, isActive: true },
      { name: 'Cancha Padel 2', type: 'padel' as const, description: 'Cancha de pádel techada', pricePerHour: 2500, isActive: true },
      { name: 'Cancha Padel 3', type: 'padel' as const, description: 'Cancha de pádel premium con iluminación LED', pricePerHour: 3000, isActive: true },
    ]

    // Create 3 football courts
    const footballCourts = [
      { name: 'Cancha Fútbol 1', type: 'football' as const, description: 'Cancha de fútbol 5 con césped sintético', pricePerHour: 3000, isActive: true },
      { name: 'Cancha Fútbol 2', type: 'football' as const, description: 'Cancha de fútbol 7 al aire libre', pricePerHour: 4000, isActive: true },
      { name: 'Cancha Fútbol 3', type: 'football' as const, description: 'Cancha de fútbol 11 con tribuna', pricePerHour: 6000, isActive: true },
    ]

    for (const courtData of [...padelCourts, ...footballCourts]) {
      const court = await Court.updateOrCreate({ name: courtData.name }, courtData)

      // Delete existing price ranges for idempotency
      await CourtPriceRange.query().where('court_id', court.id).delete()

      if (courtData.type === 'padel') {
        // Padel courts: 8-15h: 2000, 15-19h: 2500, 19-24h: 3000
        await CourtPriceRange.createMany([
          { courtId: court.id, startHour: 8, endHour: 15, pricePerHour: 2000 },
          { courtId: court.id, startHour: 15, endHour: 19, pricePerHour: 2500 },
          { courtId: court.id, startHour: 19, endHour: 24, pricePerHour: 3000 },
        ])
      } else {
        // Football courts: 8-15h: 3000, 15-19h: 4000, 19-24h: 6000
        await CourtPriceRange.createMany([
          { courtId: court.id, startHour: 8, endHour: 15, pricePerHour: 3000 },
          { courtId: court.id, startHour: 15, endHour: 19, pricePerHour: 4000 },
          { courtId: court.id, startHour: 19, endHour: 24, pricePerHour: 6000 },
        ])
      }
    }

    console.log('✓ Seeder completado')
    console.log('  Admin: admin@padel.com / admin123')
    console.log('  Worker: worker@padel.com / worker123')
  }
}
