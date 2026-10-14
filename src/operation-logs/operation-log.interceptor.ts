import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import {
  OperationCategory,
  OperationEntry,
  OperationLogsService,
} from './operation-logs.service';

type AuditRequest = Request & { user?: AuthenticatedUser };
type Action = {
  category: OperationCategory;
  label: string;
  parentKey?: string;
  resultId?: boolean;
};

const resources: Record<string, string> = {
  AgenciesController: '旅行社',
  CitiesController: '城市',
  HotelsController: '酒店',
  RestaurantsController: '餐厅',
  AttractionsController: '景点',
  TransportsController: '车型',
  GuidesController: '导游服务价格',
  GuidePeopleController: '导游人员',
  FlightsController: '航班信息',
};

function actionFor(
  controller: string,
  handler: string,
  body: Record<string, unknown>,
): Action | null {
  if (controller === 'AuthController') {
    if (handler === 'login') return { category: 'login', label: '登录' };
    if (handler === 'logout') return { category: 'login', label: '退出登录' };
    if (handler === 'changePassword')
      return { category: 'user', label: '本人修改密码' };
    if (handler === 'updateProfile')
      return { category: 'user', label: '编辑本人资料' };
  }
  if (controller === 'InquiriesController') {
    const actions: Record<string, Action> = {
      create: { category: 'inquiry', label: '新增询盘', resultId: true },
      update: { category: 'inquiry', label: '编辑询盘' },
      transfer: { category: 'inquiry', label: '转交询盘' },
      archive: { category: 'inquiry', label: '归档询盘' },
      parseDocument: { category: 'inquiry', label: '解析询盘文档' },
      contact: {
        category: 'resource',
        label: '新增旅行社联系人',
        parentKey: 'id',
        resultId: true,
      },
      createPlan: {
        category: 'itinerary',
        label: '新增行程',
        parentKey: 'id',
        resultId: true,
      },
    };
    return actions[handler] ?? null;
  }
  if (controller === 'ItinerariesController') {
    const actions: Record<string, Action> = {
      save: { category: 'itinerary', label: '保存行程' },
      copy: {
        category: 'itinerary',
        label: '复制行程',
        parentKey: 'id',
        resultId: true,
      },
      previewQuote: { category: 'quotation', label: '报价试算' },
      confirm: { category: 'quotation', label: '冻结报价' },
      downloadClick: { category: 'quotation', label: '报价下载点击' },
    };
    return actions[handler] ?? null;
  }
  if (controller === 'WebsiteController') {
    const actions: Record<string, Action> = {
      create: { category: 'inquiry', label: '新增独立站询盘', resultId: true },
      update: { category: 'inquiry', label: '编辑独立站询盘' },
      transfer: { category: 'inquiry', label: '转交独立站询盘' },
      archive: { category: 'inquiry', label: '归档独立站询盘' },
      createItinerary: {
        category: 'itinerary',
        label: '新增独立站行程',
        parentKey: 'id',
        resultId: true,
      },
      saveItinerary: { category: 'itinerary', label: '保存独立站行程' },
      copy: {
        category: 'itinerary',
        label: '复制独立站行程',
        parentKey: 'id',
        resultId: true,
      },
      generate: { category: 'itinerary', label: '生成独立站行程' },
      confirm: { category: 'quotation', label: '冻结独立站报价' },
      downloadClick: { category: 'quotation', label: '独立站报价下载点击' },
      saveConfig: { category: 'website-config', label: '保存独立站配置' },
    };
    return actions[handler] ?? null;
  }
  if (controller === 'ToursController') {
    if (handler === 'saveRating')
      return { category: 'guide-rating', label: '保存导游评分' };
    const labels: Record<string, string> = {
      create: '新增旅行团',
      update: '编辑旅行团',
      cancel: '撤销旅行团',
    };
    return labels[handler]
      ? { category: 'tour', label: labels[handler] }
      : null;
  }
  if (controller === 'GuideLeavesController') {
    const labels: Record<string, string> = {
      create: '新增导游请假',
      update: '编辑导游请假',
      delete: '删除导游请假',
    };
    return labels[handler]
      ? { category: 'guide-leave', label: labels[handler] }
      : null;
  }
  if (controller === 'UserManagementController') {
    const labels: Record<string, string> = {
      create: '新增用户',
      update: '编辑用户',
      delete: '删除用户',
      resetPassword: '重置用户密码',
    };
    if (labels[handler]) return { category: 'user', label: labels[handler] };
  }
  const dictionary =
    controller === 'SystemDictionariesController'
      ? '系统'
      : controller === 'SystemBusinessDictionariesController'
        ? '业务'
        : null;
  if (dictionary) {
    const verb = handler.startsWith('create')
      ? '新增'
      : handler.startsWith('update')
        ? '编辑'
        : handler.startsWith('delete')
          ? '删除'
          : null;
    if (verb)
      return {
        category:
          dictionary === '系统' ? 'system-category' : 'business-category',
        label: `${verb}${dictionary}分类${handler.includes('Item') ? '选项' : ''}`,
        parentKey: handler.includes('Item')
          ? dictionary === '系统'
            ? 'dictCode'
            : 'typeCode'
          : undefined,
      };
  }
  const resource = resources[controller];
  if (!resource) return null;
  const suffix = handler.includes('Price')
    ? '价格'
    : handler.includes('Contact')
      ? '联系人'
      : '';
  const verb = handler.startsWith('create')
    ? '新增'
    : handler.startsWith('update')
      ? '编辑'
      : handler.startsWith('delete')
        ? '删除'
        : null;
  if (!verb) return null;
  const statusOnly =
    handler === 'update' &&
    'status' in body &&
    Object.keys(body).every((key) => ['status', 'version'].includes(key));
  const label = statusOnly
    ? `${body.status === 'enabled' || body.status === 1 ? '启用' : '停用'}${resource}`
    : `${verb}${resource}${suffix}`;
  const parentKey =
    suffix === '价格'
      ? controller === 'RestaurantsController'
        ? 'restaurantId'
        : 'attractionId'
      : suffix === '联系人'
        ? 'agencyId'
        : undefined;
  return { category: 'resource', label, parentKey };
}

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ids);
  return typeof value === 'string'
    ? value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
}

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);
  constructor(private readonly logs: OperationLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const body =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};
    const action = actionFor(
      context.getClass().name,
      context.getHandler().name,
      body,
    );
    if (!action) return next.handle();

    const base = (success: boolean): Omit<OperationEntry, 'detail'> => ({
      category: action.category,
      action: action.label,
      success,
      actorId: request.user?.id ?? null,
      actorName: (
        request.user?.username ??
        (typeof body.username === 'string' ? body.username : '')
      ).slice(0, 80),
      scope:
        (
          request.user?.scope ??
          (typeof body.scope === 'string' ? body.scope : null)
        )?.slice(0, 32) ?? null,
      ip: (request.ip ?? '').slice(0, 64),
    });
    const detail = (id: unknown, error?: unknown): string => {
      const data: Record<string, string | number> = {};
      if (typeof id === 'string') data.recordId = id.slice(0, 100);
      if (action.parentKey && request.params[action.parentKey] != null)
        data.parentId = String(request.params[action.parentKey]).slice(0, 100);
      if (error !== undefined) {
        data.statusCode =
          error instanceof HttpException ? error.getStatus() : 500;
        if (error instanceof BusinessException) data.errorCode = error.code;
      }
      return JSON.stringify(data);
    };
    const targetIds = (item: Record<string, unknown> = {}): unknown[] => {
      if (context.getHandler().name.startsWith('delete'))
        return ids(request.query.ids);
      const recordId = action.resultId
        ? item.id
        : (request.params.id ??
          request.params.priceId ??
          request.params.contactId ??
          item.id);
      return [
        recordId ??
          (context.getClass().name === 'AuthController'
            ? request.user?.id
            : null),
      ];
    };

    return next.handle().pipe(
      mergeMap((result: unknown) =>
        from(
          (async () => {
            const value =
              result && typeof result === 'object' && 'data' in result
                ? result.data
                : result;
            const item =
              value && typeof value === 'object'
                ? (value as Record<string, unknown>)
                : {};
            const targets = targetIds(item);
            const entries = (targets.length ? targets : [null]).map(
              (id): OperationEntry => ({
                ...base(true),
                detail: detail(id),
              }),
            );
            await this.write(entries);
            return result;
          })(),
        ),
      ),
      catchError((error: unknown) => {
        const targets = targetIds();
        return from(
          this.write(
            (targets.length ? targets : [null]).map((id) => ({
              ...base(false),
              detail: detail(id, error),
            })),
          ),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  private async write(entries: OperationEntry[]): Promise<void> {
    try {
      await this.logs.append(entries);
    } catch (error) {
      this.logger.error(
        'Operation log write failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
