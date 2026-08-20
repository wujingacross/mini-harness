import { Context, Service } from 'cordis'
import { BashExecutor, type BashRunOptions, type BashRunResult } from './types.js'
import { LocalBashExecutor, type LocalBashConfig } from './local.js'

export * from './types.js'
export * from './local.js'

declare module 'cordis' {
  interface Context {
    bash: BashService
  }
}

export class BashService extends Service {
  private executor: BashExecutor

  constructor(ctx: Context, config?: LocalBashConfig) {
    super(ctx, 'bash')
    this.executor = new LocalBashExecutor(config)
  }

  setExecutor(executor: BashExecutor): void {
    this.executor = executor
  }

  async run(options: BashRunOptions): Promise<BashRunResult> {
    return await this.executor.run(options)
  }
}

export default BashService
