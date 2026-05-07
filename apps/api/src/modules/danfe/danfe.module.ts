import { Module } from '@nestjs/common';
import { DanfeController } from './danfe.controller';
import { DanfeService } from './danfe.service';

@Module({
  controllers: [DanfeController],
  providers: [DanfeService],
  exports: [DanfeService],
})
export class DanfeModule {}
