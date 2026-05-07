import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { SoapClientService } from './soap-client.service';
import { XmlSignerService } from './xml-signer.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CircuitBreakerService, SoapClientService, XmlSignerService],
  exports: [CircuitBreakerService, SoapClientService, XmlSignerService],
})
export class SefazModule {}
