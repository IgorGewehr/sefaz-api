import { SetMetadata } from '@nestjs/common';
import { PUBLIC_ROUTE } from './api-key.guard';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
