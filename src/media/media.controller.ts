import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { chatFail } from '../whatsapp/whatsapp.policy';
import { MediaService } from './media.service';
import { MediaQuery, UpdateMediaDto, MediaVersionDto } from './media.dto';
import { MAX_IMAGE_BYTES } from './media.images';
export const imageUploadOptions = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
};
export function imageFile(file: Express.Multer.File | undefined) {
  if (!file) chatFail('VALIDATION_ERROR', '请选择图片', 400);
  return file;
}
@ApiTags('OSS Management')
@ApiBearerAuth()
@Controller('system/oss/resources')
export class MediaController {
  constructor(private readonly service: MediaService) {}
  @Get()
  @Permissions('sys:oss:list')
  list(@Query() q: MediaQuery, @CurrentUser() u: AuthenticatedUser) {
    return this.service.list(q, u);
  }
  @Get(':id')
  @Permissions('sys:oss:list')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.detail(id, u);
  }
  @Post()
  @Permissions('sys:oss:create')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  create(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    this.service.admin(u, 'create');
    const f = imageFile(file);
    return this.service.upload(f.buffer, f.originalname, u);
  }
  @Put(':id')
  @Permissions('sys:oss:update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMediaDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.update(id, body, u);
  }
  @Delete(':id')
  @Permissions('sys:oss:delete')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MediaVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.remove(id, query.version, u);
  }
  @Post(':id/retry')
  @HttpCode(200)
  @Permissions('sys:oss:update')
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MediaVersionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.service.retry(id, body.version, u);
  }
}
