import { ConfigService } from '@nestjs/config';
import { createTypeOrmOptions } from './typeorm.config';
import { ArgumentsHost, Logger } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Options } from 'pino-http';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { createLoggerModuleOptions } from './logger';

function log(context: string, error = false): unknown {
  const options = createLoggerModuleOptions().pinoHttp as Options;
  const request = {
    method: 'POST',
    url: '/api/resources/guide-people',
  } as IncomingMessage;
  const response = {
    statusCode: error ? 500 : 201,
    locals: {
      httpLogSource: {
        context,
        body: {
          identityNumber: 'FAKE-ID',
          certificateNo: 'FAKE-CERT',
          nested: { identity_number: 'FAKE-ID' },
          password: 'FAKE-PASSWORD',
        },
        query: { keyword: 'FAKE-ID' },
        params: { id: 'record-id' },
      },
    },
  } as unknown as ServerResponse;
  return error
    ? options.customErrorObject!(request, response, new Error('failed'), {})
    : options.customSuccessObject!(request, response, {});
}
describe('certificate log protection', () => {
  it.each([false, true])(
    'omits guide request body and certificate search on error=%s',
    (error) => {
      const result = log('GuidePeopleController', error);
      expect(result).toMatchObject({ params: { id: 'record-id' } });
      expect(result).not.toHaveProperty('body');
      expect(result).not.toHaveProperty('query');
      expect(JSON.stringify(result)).not.toContain('FAKE-');
    },
  );
  it('redacts certificate fields recursively on other routes', () => {
    expect(log('OtherController')).toMatchObject({
      body: {
        identityNumber: '[REDACTED]',
        certificateNo: '[REDACTED]',
        nested: { identity_number: '[REDACTED]' },
      },
    });
  });
  it('never enables raw SQL parameter logging, including development', () => {
    const config = new ConfigService({
      NODE_ENV: 'development',
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'unused',
      DATABASE_USER: 'unused',
      DATABASE_PASSWORD: 'unused',
      DATABASE_SSL: 'false',
    });
    expect(createTypeOrmOptions(config).logging).toBe(false);
  });
  it('omits raw database error text and stack on guide routes', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const request = {
        path: '/api/resources/guide-people',
        originalUrl: '/api/resources/guide-people',
        method: 'POST',
        headers: {},
      };
      const response = {
        locals: {},
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;
      new ApiExceptionFilter().catch(
        new Error('FAKE-ID in database error'),
        host,
      );
      expect(JSON.stringify(spy.mock.calls)).not.toContain('FAKE-ID');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
