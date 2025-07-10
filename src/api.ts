import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import axiosRetry from "axios-retry";
import Bottleneck from "bottleneck";

export interface Credentials {
  apiKey: string;
  secretApiKey: string;
}

export interface PingResponse {
  status: string;
  yourIp: string;
}

export interface Domain {
  domain: string;
  status: string;
  tld: string;
  createDate: string;
  expireDate: string;
  securityLock: string;
  whoisPrivacy: string;
  autoRenew: number;
  notLocal: number;
  labels?: Label[];
}

export interface Label {
  id: string;
  title: string;
  color: string;
}

export interface ListDomainsRequest {
  start?: number;
  includeLabels?: "yes";
}

export interface ListDomainsResponse {
  status: string;
  domains: Domain[];
}

export interface AddUrlForwardRequest {
  subdomain?: string;
  location: string;
  type: "permanent" | "temporary";
  includePath: "yes" | "no";
  wildcard: "yes" | "no";
}

export interface GetUrlForwardsResponse {
  status: string;
  forwards: UrlForward[];
}

export interface UrlForward {
  id: string;
  subdomain: string;
  location: string;
  type: string;
  includePath: string;
  wildcard: string;
}

export type DNSReadRequest =
  | {
      domain: string;
      id?: string;
    }
  | {
      domain: string;
      type: string;
      subdomain?: string;
    };

export type DNSWriteRequest =
  | {
      domain: string;
      id: string;
    }
  | {
      domain: string;
      type: string;
      subdomain?: string;
    };

export interface DNSRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  ttl: string;
  prio: string;
  notes: string;
}

export interface NewDNSRecord {
  name?: string;
  type: string;
  content: string;
  ttl?: string;
  prio?: string;
}

export interface RetrieveDNSRecordsResponse {
  status: string;
  records: DNSRecord[];
}

export interface CreateDNSRecordResponse {
  status: string;
  id: string;
}

export interface EditDNSRecordRequest {
  name?: string;
  type: string;
  content: string;
  ttl?: string;
  prio?: string;
}

export interface UpdateNameserversRequest {
  ns: string[];
}

export interface IAxiosCompactError {
  response?: Pick<AxiosResponse, "status" | "data" | "headers">;
  request?: AxiosError["request"];
  config?: Pick<AxiosRequestConfig, "url" | "method" | "headers">;
}

class AxiosCompactError implements IAxiosCompactError {
  response?: Pick<AxiosResponse, "status" | "data" | "headers">;
  request?: AxiosError["request"];
  config?: Pick<AxiosRequestConfig, "url" | "method" | "headers" | "data">;
}

const limiter = new Bottleneck({
  // Porkbun starts getting uppity when you hit 350 requests in a 5 minute period
  // So we'll limit to 325 requests in a 5 minute period
  minTime: (5 * 60 * 1000) / 325,
});

export interface Options {
  numRetries?: number;
}

export class PorkbunAPI {
  private apiKey: string;
  private secretApiKey: string;
  private axiosInstance: AxiosInstance;

  constructor(credentials: Credentials, options: Options = {}) {
    this.apiKey = credentials.apiKey;
    this.secretApiKey = credentials.secretApiKey;

    this.axiosInstance = axios.create({
      baseURL: "https://api.porkbun.com/api/json/v3",
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Retry failed requests
    axiosRetry(this.axiosInstance, {
      retries: options.numRetries ?? 10,
      validateResponse: response => {
        // If we get a 202, consider it a failure
        if (response.status === 202) {
          return false;
        }

        // Otherwise, only resolve 2xx responses as successful
        return response.status >= 200 && response.status < 300;
      },
      retryCondition: error => {
        return (
          error.code === "ECONNABORTED" ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT" ||
          error.response?.status === 405 || // Method Not Allowed (probably means we're getting a CAPTCHA)
          isBadRequestAndNotInvalidAPIKeyOrDomainNotOptedIn(error) || // Bad Request, but not due to an invalid API key
          error.response?.status === 429 || // Rate limit exceeded
          error.response?.status === 502 || // Bad Gateway
          error.response?.status === 503 || // Service Unavailable
          error.response?.status === 202 // Accepted - almost always an eventual failure
        );
      },
      retryDelay: (retryCount, error) => {
        // If the error is a 202, retry in 5 minutes the first time, then an additional minute each time
        if (error.response?.status === 202) {
          const delay = getDelay(retryCount);
          const numSeconds = Math.floor(delay / 1000);
          console.log(`Received HTTP 202. Retrying in ${numSeconds} seconds.`);
          return delay;
        }

        // If the error is not a 429 (rate limit), use exponential backoff
        if (error.response?.status !== 429) {
          const delay = axiosRetry.exponentialDelay(retryCount);
          console.log(
            `Received HTTP ${error.response?.status}. Retrying in ${Math.floor(delay / 1000)} seconds.`
          );
          return delay;
        }

        // If the error is a 429, attempt to use the rate limit header
        const resetHeader = error.response?.headers["x-ratelimit-reset"];

        // If header is missing, default to 60 seconds
        if (!resetHeader) {
          return 60 * 1000;
        }

        // Calculate the time until the rate limit resets
        const resetTime = parseInt(resetHeader, 10); // In seconds
        const currentTime = new Date().getTime() / 1000; // In seconds
        const bufferSeconds = 2; // Add a buffer to ensure the rate limit has reset
        const delaySeconds = resetTime - currentTime + bufferSeconds;
        console.log(
          `Rate limit exceeded. Retrying in ${delaySeconds} seconds.`
        );
        return delaySeconds * 1000;
      },
    });
  }

  private async _post<T>(path: string, data: object = {}): Promise<T> {
    const response = await this.axiosInstance
      .post(path, {
        ...data,
        apikey: this.apiKey,
        secretapikey: this.secretApiKey,
      })
      .catch((error: AxiosError) => {
        throw this.handleAxiosError(error);
      });
    if (response.data.status !== "SUCCESS") {
      console.error(response);
      throw new Error(response.data.message);
    }
    return response.data;
  }

  private post = limiter.wrap(
    this._post.bind(this) as any
  ) as typeof this._post;

  private handleAxiosError(error: AxiosError): AxiosCompactError {
    const compactError = new AxiosCompactError();
    if (error.response) {
      compactError.response = {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
      };
    } else if (error.request) {
      compactError.request = error.request;
    }

    if (error.config) {
      compactError.config = {
        url: error.config.url,
        method: error.config.method,
        headers: error.config.headers,
        data: error.config.data,
      };
    }
    return compactError;
  }

  async ping(): Promise<PingResponse> {
    return this.post<PingResponse>("/ping");
  }

  async listDomains(
    request: ListDomainsRequest = {}
  ): Promise<ListDomainsResponse> {
    return this.post<ListDomainsResponse>("/domain/listAll", request);
  }

  async addUrlForward(
    domain: string,
    request: AddUrlForwardRequest
  ): Promise<{ status: string }> {
    return this.post<{ status: string }>(
      `/domain/addUrlForward/${domain}`,
      request
    );
  }

  async getUrlForwards(domain: string): Promise<GetUrlForwardsResponse> {
    return this.post<GetUrlForwardsResponse>(
      `/domain/getUrlForwarding/${domain}`
    );
  }

  async deleteUrlForward(
    domain: string,
    id: string
  ): Promise<{ status: string }> {
    return this.post<{ status: string }>(
      `/domain/deleteUrlForward/${domain}/${id}`
    );
  }

  async editDNSRecords(
    request: DNSWriteRequest,
    update: EditDNSRecordRequest
  ): Promise<{ status: string }> {
    if ("type" in request) {
      const url =
        "subdomain" in request
          ? `/dns/editByNameType/${request.domain}/${request.type}/${request.subdomain}`
          : `/dns/editByNameType/${request.domain}/${request.type}`;
      return this.post<{ status: string }>(url, update);
    }

    return this.post<{ status: string }>(
      `/dns/edit/${request.domain}/${request.id}`,
      update
    );
  }
  async deleteDNSRecords(
    request: DNSWriteRequest
  ): Promise<{ status: string }> {
    if ("type" in request) {
      const url =
        "subdomain" in request
          ? `/dns/deleteByNameType/${request.domain}/${request.type}/${request.subdomain}`
          : `/dns/deleteByNameType/${request.domain}/${request.type}`;
      return this.post<{ status: string }>(url);
    }

    return this.post<{ status: string }>(
      `/dns/delete/${request.domain}/${request.id}`
    );
  }

  async retrieveDNSRecords(
    request: DNSReadRequest
  ): Promise<RetrieveDNSRecordsResponse> {
    if ("type" in request) {
      const url =
        "subdomain" in request
          ? `/dns/retrieveByNameType/${request.domain}/${request.type}/${request.subdomain}`
          : `/dns/retrieveByNameType/${request.domain}/${request.type}`;
      return this.post<RetrieveDNSRecordsResponse>(url);
    }

    const url = request.id
      ? `/dns/retrieve/${request.domain}/${request.id}`
      : `/dns/retrieve/${request.domain}`;
    return this.post<RetrieveDNSRecordsResponse>(url);
  }

  async createDNSRecord(
    domain: string,
    record: NewDNSRecord
  ): Promise<CreateDNSRecordResponse> {
    return this.post<CreateDNSRecordResponse>(`/dns/create/${domain}`, record);
  }

  async createOrUpdateDNSRecord(
    domain: string,
    record: NewDNSRecord & { name?: string }
  ): Promise<CreateDNSRecordResponse | { status: string }> {
    // Build the lookup request by name/type or just type
    const lookupRequest = record.name
      ? { domain, type: record.type, subdomain: record.name }
      : { domain, type: record.type };

    // See if any existing records match
    const existing = await this.retrieveDNSRecords(lookupRequest);

    console.log(
      `Found ${existing.records.length} existing records for ${record.name || domain} with type ${record.type}.`
    );
    console.log({ existingRecords: existing.records, record });

    if (existing.records.length > 0) {
      // If there's already a record with the same name, type, and content,
      // we can skip the update
      const exactMatch = existing.records.some(
        r =>
          r.content === record.content &&
          r.type === record.type &&
          r.name === [record.name, domain].filter(Boolean).join(".") &&
          (record.ttl === undefined || r.ttl === record.ttl) &&
          (record.prio === undefined || r.prio === record.prio)
      );

      if (exactMatch) {
        console.log(
          `Record already exists for ${record.name || domain} with type ${record.type} and content ${record.content}. Skipping update.`
        );
        return { status: "Record already exists" };
      }

      // Prepare update payload
      const updatePayload: EditDNSRecordRequest = {
        type: record.type,
        content: record.content,
        ...(record.ttl !== undefined && { ttl: record.ttl }),
        ...(record.prio !== undefined && { prio: record.prio }),
        // name is only needed for name‐based edits
        ...(record.name && { name: record.name }),
      };

      // Build the write request (same shape as lookupRequest)
      const writeRequest = lookupRequest as DNSWriteRequest;
      return this.editDNSRecords(writeRequest, updatePayload);
    } else {
      // No existing record, create a new one
      return this.createDNSRecord(domain, record);
    }
  }

  async getNameservers(
    domain: string
  ): Promise<{ status: string; ns: string[] }> {
    return this.post<{ status: string; ns: string[] }>(
      `/domain/getNs/${domain}`
    );
  }

  async updateNameservers(
    domain: string,
    request: UpdateNameserversRequest
  ): Promise<{ status: string }> {
    return this.post<{ status: string }>(`/domain/updateNs/${domain}`, request);
  }

  async restoreDefaultNameservers(domain: string): Promise<{ status: string }> {
    return this.updateNameservers(domain, {
      ns: [
        "maceio.ns.porkbun.com",
        "curitiba.ns.porkbun.com",
        "salvador.ns.porkbun.com",
        "fortaleza.ns.porkbun.com",
      ],
    });
  }
}

function isBadRequestAndNotInvalidAPIKeyOrDomainNotOptedIn(
  error: AxiosError<any, any>
): boolean {
  if (error.response?.status !== 400) {
    return false;
  }

  const errorMessage = error.response?.data?.message;

  if (typeof errorMessage !== "string") {
    return true;
  }

  return (
    !errorMessage.includes("Invalid API key") &&
    !errorMessage.includes("Domain is not opted in to API")
  );
}

function getDelay(retryCount: number): number {
  // Retry in 5 minutes the first time
  if (retryCount === 1) {
    return 5 * 60 * 1000;
  }

  // Retry in 1 minute for each additional retry
  return 60 * 1000;
}
