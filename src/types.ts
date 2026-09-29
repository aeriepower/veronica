export type Env = {
  DB: D1Database
  TOKEN: string
  // Workers AI (opcional: sin binding, la capa 3 de inferencia se omite)
  AI?: Ai
}
