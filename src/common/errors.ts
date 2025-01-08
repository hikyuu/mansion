type ErrorName = 'GET_PROJECT_ERROR' | 'CREATE_PROJECT_ERROR' | 'PROJECT_LIMIT_REACHED'

export class ProjectError extends Error {
  name: ErrorName
  message: string
  cause: any

  constructor({ name, message, cause }: { name: ErrorName; message: string; cause?: any }) {
    super()
    this.name = name
    this.message = message
    this.cause = cause
  }
}
