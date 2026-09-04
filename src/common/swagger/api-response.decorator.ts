import { HttpStatus, Type, applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse as SwaggerApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiErrorResponse,
  ApiResponse,
  PageResult,
} from './api-contract.model';

interface SuccessResponseOptions {
  status?: HttpStatus;
  description?: string;
  type?: Type<unknown>;
  isArray?: boolean;
}

export function ApiSuccessResponse(options: SuccessResponseOptions = {}) {
  const dataSchema = options.type
    ? options.isArray
      ? { type: 'array', items: { $ref: getSchemaPath(options.type) } }
      : { $ref: getSchemaPath(options.type) }
    : {};
  const extraModels = options.type
    ? ApiExtraModels(ApiResponse, options.type)
    : ApiExtraModels(ApiResponse);

  return applyDecorators(
    extraModels,
    SwaggerApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponse) },
          { properties: { data: dataSchema } },
        ],
      },
    }),
  );
}

export function ApiPaginatedResponse(
  itemType: Type<unknown>,
  description?: string,
) {
  return applyDecorators(
    ApiExtraModels(ApiResponse, PageResult, itemType),
    SwaggerApiResponse({
      status: HttpStatus.OK,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponse) },
          {
            properties: {
              data: {
                allOf: [
                  { $ref: getSchemaPath(PageResult) },
                  {
                    properties: {
                      list: {
                        type: 'array',
                        items: { $ref: getSchemaPath(itemType) },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  );
}

export function ApiCommonErrorResponses() {
  const responses = [
    [HttpStatus.BAD_REQUEST, 'Bad request or validation error'],
    [HttpStatus.UNAUTHORIZED, 'Authentication required or token invalid'],
    [HttpStatus.FORBIDDEN, 'Insufficient permission'],
    [HttpStatus.NOT_FOUND, 'Resource not found'],
    [HttpStatus.CONFLICT, 'Business state conflict'],
    [HttpStatus.TOO_MANY_REQUESTS, 'Too many requests'],
    [HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'],
  ] as const;

  return applyDecorators(
    ApiExtraModels(ApiErrorResponse),
    ...responses.map(([status, description]) =>
      SwaggerApiResponse({
        status,
        description,
        schema: { $ref: getSchemaPath(ApiErrorResponse) },
      }),
    ),
  );
}
