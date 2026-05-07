import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SpedController } from './sped.controller';
import { SpedService } from './sped.service';
import { SPED_QUEUE } from './sped.constants';

@Module({
  imports: [BullModule.registerQueue({ name: SPED_QUEUE })],
  controllers: [SpedController],
  providers: [SpedService],
  exports: [SpedService],
})
export class SpedModule {}
