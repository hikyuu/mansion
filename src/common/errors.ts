type ErrorName = 'GET_PROJECT_ERROR' | 'CREATE_PROJECT_ERROR' | 'PROJECT_LIMIT_REACHED'

export class ProjectError extends Error {
  name: ErrorName
  message: string
  cause: unknown

  constructor({ name, message, cause }: { name: ErrorName; message: string; cause?: unknown }) {
    super()
    this.name = name
    this.message = message
    this.cause = cause
  }
}
