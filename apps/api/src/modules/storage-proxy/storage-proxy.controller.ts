import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorageService, LocalStorageProvider } from '@app/storage';
import { Public } from '../../app/guards/public.decorator';

/**
 * Verifies HMAC-signed presigned URLs issued by the local storage provider
 * and streams the bytes back. In production with S3 this controller is
 * unused — clients hit S3 directly via S3.getSignedUrl().
 */
@ApiTags('internal')
@Controller('internal/storage')
export class StorageProxyController {
  constructor(private readonly storage: StorageService) {}

  @Get(':key')
  @Public()
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({ summary: 'Stream bytes for a local-storage presigned URL' })
  async serve(
    @Param('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!exp || !sig) throw new BadRequestException('exp/sig required');
    // Local provider only — guard against accidental use in S3 mode.
    const provider = (this.storage as unknown as { provider: unknown }).provider;
    if (!(provider instanceof LocalStorageProvider)) {
      throw new ForbiddenException('Internal storage proxy is only for the local provider');
    }
    if (!provider.verifySignature(decodeURIComponent(key), exp, sig)) {
      throw new ForbiddenException('Invalid signature or URL expired');
    }
    const bytes = await this.storage.get(decodeURIComponent(key));
    res.send(bytes);
  }
}
