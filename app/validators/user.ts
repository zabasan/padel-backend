import vine from '@vinejs/vine'

const password = () => vine.string().minLength(6).maxLength(64)

export const signupValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim(),
    email: vine.string().email().trim().unique({ table: 'users', column: 'email' }),
    password: password(),
    phone: vine.string().trim().minLength(6).unique({ table: 'users', column: 'phone' }),
    padelCategory: vine
      .enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'] as const)
      .optional()
      .nullable(),
  })
)

export const loginValidator = vine.compile(
  vine.object({
    identifier: vine.string().trim(),
    password: vine.string(),
  })
)
