export interface ApiErrorResponse {
  code: string;
  message: string;
  data: null;
  details?: Record<string, unknown>;
  timestamp: string;
  path: string;
  requestId?: string;
}
