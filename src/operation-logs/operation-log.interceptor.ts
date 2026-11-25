import { QueryFailedError } from 'typeorm';
import { normalizeDatabaseError } from '../common/filters/api-exception.filter';
import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { LOGIN_SCOPES } from '../users/user-identity.entity';
import {
  additionalCommand,
  isUserAction,
  writesOwnSuccess,
} from './operation-routes';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import {
  OperationCategory,
  OperationEntry,
  OperationResult,
  OperationLogsService,
} from './operation-logs.service';

export type AuditActor = Pick<AuthenticatedUser, 'id' | 'username' | 'scope'>;
export type AuditRequest = Request & {
  auditActor?: AuditActor;
  auditGuardFailure?: (status: number, code: string) => Promise<void>;
  user?: AuthenticatedUser;
  menuPermissionChange?: unknown;
  tourGuideServiceChange?: unknown;
};
type Action = {
  category: OperationCategory;
  label: string;
  parentKey?: string;
  resultId?: boolean;
};

const resources: Record<string, string> = {
  AgenciesController: '组团社',
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
  ledgerUnit?: unknown,
): Action | null {
  if (
    controller === 'MediaController' &&
    ['create', 'update', 'remove', 'retry'].includes(handler)
  )
    return {
      category: 'system-category',
      label: (
        {
          create: '上传OSS资源',
          update: '编辑OSS资源',
          remove: '删除OSS资源',
          retry: '重试OSS媒体保存',
        } as Record<string, string>
      )[handler],
      resultId: handler === 'create',
    };
  if (controller === 'WhatsappController' && handler === 'retryEvent')
    return { category: 'system-category', label: '重试WhatsApp接收事件' };
  if (
    controller === 'WhatsappController' &&
    (handler === 'uploadImage' || handler === 'uploadDocument')
  )
    return {
      category: 'business-category',
      label:
        handler === 'uploadImage'
          ? '上传WhatsApp图片草稿'
          : '上传WhatsApp文件草稿',
      resultId: true,
      parentKey: 'id',
    };
  if (controller === 'WhatsappController' && handler === 'updateRuntime')
    return { category: 'system-category', label: '修改WhatsApp收发开关' };
  if (controller === 'WhatsappQuickRepliesController') {
    if (handler === 'create')
      return {
        category: 'business-category',
        label: '新增WhatsApp快捷回复',
        resultId: true,
      };
    if (handler === 'update')
      return { category: 'business-category', label: '编辑WhatsApp快捷回复' };
  }
  if (controller === 'NotificationSettingsController' && handler === 'update')
    return { category: 'system-category', label: '配置飞书通知开关' };
  if (controller === 'MenuPermissionsController' && handler === 'save')
    return { category: 'system-category', label: '配置菜单权限' };
  if (controller === 'AuthController') {
    if (handler === 'login') return { category: 'login', label: '登录' };
    if (handler === 'logout') return { category: 'login', label: '退出登录' };
    if (handler === 'changePassword')
      return { category: 'user', label: '本人修改密码' };
    if (handler === 'updateProfile')
      return { category: 'user', label: '编辑本人资料' };
  }
  if (
    controller === 'ShengxuLedgersController' ||
    controller === 'DirectLedgersController'
  ) {
    const ledger =
      controller === 'ShengxuLedgersController'
        ? '盛旭台账'
        : ledgerUnit === 'linxi'
          ? '霖熹台账'
          : ledgerUnit === 'website'
            ? '独立站台账'
            : '直客台账';
    const labels: Record<string, string> = {
      create: `新增${ledger}`,
      update: `编辑${ledger}`,
      delete: `删除${ledger}`,
      ...(controller === 'DirectLedgersController'
        ? {
            review: `审核${ledger}`,
            operate: `保存${ledger}操作信息`,
            convert: `${ledger}成团`,
          }
        : {}),
    };
    return labels[handler]
      ? { category: 'ledger', label: labels[handler] }
      : null;
  }
  if (controller === 'WebsiteVisitsController') {
    if (handler === 'confirm')
      return { category: 'website-visit', label: '确认独立站访问记录' };
    if (handler === 'create')
      return {
        category: 'website-visit',
        label: '访问记录生成询盘',
        parentKey: 'id',
        resultId: true,
      };
    if (handler === 'export')
      return { category: 'website-visit', label: '导出独立站访问记录' };
  }
  if (controller === 'InquiriesController') {
    const actions: Record<string, Action> = {
      create: { category: 'inquiry', label: '新增询盘', resultId: true },
      update: { category: 'inquiry', label: '编辑询盘' },
      addFollowUp: { category: 'inquiry', label: '新增询盘跟进' },
      transfer: { category: 'inquiry', label: '转交询盘' },
      archive: { category: 'inquiry', label: '归档询盘' },
      delete: { category: 'inquiry', label: '删除询盘' },
      parseDocument: { category: 'inquiry', label: '解析询盘文档' },
      contact: {
        category: 'resource',
        label: '新增组团社联系人',
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
      delete: { category: 'inquiry', label: '删除独立站询盘' },
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
      createConfigRecord: {
        category: 'website-config',
        label: '新增独立站配置',
        resultId: true,
      },
      updateConfigRecord: {
        category: 'website-config',
        label: '编辑独立站配置',
      },
      deleteConfigRecord: {
        category: 'website-config',
        label: '删除独立站配置',
      },
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
      testFeishu: '发送飞书测试消息',
      updateCoordinatorDuty: '设置计调分工',
      updateBusinessGroup: '调整业务组成员',
    };
    if (labels[handler]) return { category: 'user', label: labels[handler] };
  }
  if (
    controller === 'BusinessGroupsController' &&
    ['create', 'update'].includes(handler)
  )
    return {
      category: 'user',
      label: handler === 'create' ? '新增业务组' : '维护业务组',
    };
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

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const id = String(value);
  return /^(?:[0-9]{1,16}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(
    id,
  )
    ? id
    : undefined;
}

function safeCode(value: unknown) {
  return typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
    ? value
    : undefined;
}

function identity(req: AuditRequest, controller: string, handler: string) {
  const actor = req.auditActor ?? req.user;
  if (actor)
    return { actorId: actor.id, actorName: actor.username, scope: actor.scope };
  if (controller === 'AuthController' && handler === 'login') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return {
      actorId: null,
      actorName:
        typeof body.username === 'string' && body.username.trim()
          ? body.username.trim().slice(0, 80)
          : '未认证访客',
      scope: LOGIN_SCOPES.find((scope) => scope === body.scope) ?? 'unknown',
    };
  }
  return {
    actorId: null,
    actorName: '未认证访客',
    scope: 'unknown',
  };
}

function sendOutcome(item: Record<string, unknown>) {
  const messages: unknown[] = Array.isArray(item.messages)
    ? item.messages
    : [item];
  const states = new Set<string>();
  const ids: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const state = 'status' in message ? message.status : undefined;
    if (
      typeof state === 'string' &&
      [
        'queued',
        'sending',
        'accepted',
        'sent',
        'delivered',
        'read',
        'failed',
        'unknown',
      ].includes(state)
    )
      states.add(state);
    const id = safeId('id' in message ? message.id : undefined);
    if (id) ids.push(id);
  }
  let result: OperationResult = 'success';
  if (states.has('failed')) result = 'failure';
  else if (!states.size || states.has('unknown')) result = 'unknown';
  else if (['queued', 'sending', 'accepted'].some((s) => states.has(s)))
    result = 'pending';
  return {
    result,
    detail: { stage: 'send_requested', states: [...states], messageIds: ids },
  };
}

@Injectable()
export class OperationLogInterceptor implements CanActivate, NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);
  constructor(private readonly logs: OperationLogsService) {}

  // Nest guards precede interceptors. The exception filter finishes this attempt if a guard rejects it.
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuditRequest>();
    if (!isUserAction(req)) return true;
    req.auditGuardFailure = (status, code) =>
      this.record(context, undefined, { status, code, guard: true });
    return true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    delete request.auditGuardFailure;
    if (!isUserAction(request)) return next.handle();
    const direct = writesOwnSuccess(
      context.getClass().name,
      context.getHandler().name,
    );
    return next.handle().pipe(
      catchError((error: unknown) => {
        const dbError =
          error instanceof QueryFailedError
            ? normalizeDatabaseError(error.driverError)
            : undefined;
        const status =
          error instanceof HttpException
            ? error.getStatus()
            : (dbError?.status ?? 500);
        const code =
          error instanceof BusinessException ? error.code : dbError?.code;
        // Preserve the original error, including when both audit stores are unavailable.
        return from(
          this.record(context, undefined, { status, code }).catch(() =>
            this.logger.error('Failed to persist the rejected operation'),
          ),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
      mergeMap((result: unknown) =>
        direct
          ? [result]
          : from(this.record(context, result).then(() => result)),
      ),
    );
  }

  private async record(
    context: ExecutionContext,
    response: unknown,
    error?: { status: number; code?: string; guard?: boolean },
  ) {
    const req = context.switchToHttp().getRequest<AuditRequest>();
    const controller = context.getClass().name;
    const handler = context.getHandler().name;
    const body = (
      req.body && typeof req.body === 'object' ? req.body : {}
    ) as Record<string, unknown>;
    const params = req.params ?? {};
    const query = req.query ?? {};
    const value =
      response && typeof response === 'object' && 'data' in response
        ? response.data
        : response;
    const item = (value && typeof value === 'object' ? value : {}) as Record<
      string,
      unknown
    >;
    const unit =
      item.businessUnit ??
      (req.user?.scope === 'headquarters'
        ? handler === 'create'
          ? body.businessUnit
          : undefined
        : req.user?.scope);
    const action: Action | null =
      actionFor(controller, handler, body, unit) ??
      additionalCommand(controller, handler);
    if (!action) return;
    const actor = identity(req, controller, handler);
    let result: OperationEntry['result'] = error
      ? [401, 403, 429].includes(error.status)
        ? 'denied'
        : 'failure'
      : 'success';
    const details: Record<string, unknown> = {};
    const parent = action.parentKey ? params[action.parentKey] : undefined;
    if (parent)
      details.parentId = ['dictCode', 'typeCode'].includes(action.parentKey!)
        ? safeCode(parent)
        : safeId(parent);
    if (
      controller === 'NotificationSettingsController' &&
      handler === 'update'
    ) {
      details.notificationType = safeCode(params.type);
      if (typeof body.enabled === 'boolean')
        details.enabled = String(body.enabled);
      if (typeof body.version === 'number') details.version = body.version;
    }
    if (req.menuPermissionChange && !error)
      Object.assign(details, req.menuPermissionChange);
    if (
      controller === 'ToursController' &&
      !error &&
      req.tourGuideServiceChange
    )
      Object.assign(details, req.tourGuideServiceChange);
    if (handler === 'saveRating') details.guideId = safeId(params.guideId);
    if (controller === 'WebsiteController' && handler === 'createConfigRecord')
      details.group = safeCode(params.group);
    if (controller === 'WhatsappController' && params.messageId)
      details.messageId = safeId(params.messageId);
    if (controller === 'MenuPermissionsController' && error)
      details.roleCode = safeCode(params.roleCode);
    if (controller === 'WebsiteVisitsController' && handler === 'export') {
      for (const key of ['start', 'end'])
        if (
          typeof query[key] === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(query[key])
        )
          details[key] = query[key];
      if (!error) details.stage = 'stream_started';
    }
    if (!error && controller === 'WhatsappController') {
      if (
        ['send', 'sendDocument', 'sendImageBatch', 'retry', 'react'].includes(
          handler,
        )
      ) {
        const outcome = sendOutcome(item);
        Object.assign(details, outcome.detail);
        result = outcome.result;
      }
      if (handler === 'documentDownload') details.stage = 'link_issued';
    }
    if (!error && handler === 'downloadClick')
      details.stage = 'download_requested';
    if (error) {
      details.statusCode = error.status;
      if (error.code) details.errorCode = error.code;
      if (error.guard) details.stage = 'guard';
    }
    const id = safeId(
      action.resultId
        ? item.id
        : (params.id ??
            params.priceId ??
            params.contactId ??
            params.messageId ??
            item.id ??
            (controller === 'AuthController' ? actor.actorId : undefined)),
    );
    const targets = handler.startsWith('delete')
      ? [
          ...new Set(
            ids(params.id ?? query.ids)
              .map(safeId)
              .filter(Boolean),
          ),
        ]
      : [];
    const rows = (targets.length ? targets : [id]).map(
      (recordId): OperationEntry => {
        const data = { ...(recordId ? { recordId } : {}), ...details };
        if (
          !Object.values(data).some((v) => v !== undefined) ||
          (!recordId && !error)
        )
          Object.assign(data, { operation: controller + '.' + handler });
        return {
          ...actor,
          category: action.category,
          action: action.label,
          success: result === 'success',
          result,
          ip: (req.ip ?? '').slice(0, 64),
          detail: JSON.stringify(data),
        };
      },
    );
    await this.logs.append(rows);
  }
}
