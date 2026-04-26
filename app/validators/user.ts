import vine from '@vinejs/vine'

const password = () => vine.string().minLength(6).maxLength(64)

export const signupValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim(),
    email: vine.string().email().trim().unique({ table: 'users', column: 'email' }),
    password: password(),
    phone: vine.string().trim().minLength(6).unique({ table: 'users', column: 'phone' }),
  })
)

export const loginValidator = vine.compile(
  vine.object({
    identifier: vine.string().trim(),
    password: vine.string(),
  })
)
