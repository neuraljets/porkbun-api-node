import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";

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
  labels: Label[];
}

export interface Label {
  id: string;
  title: string;
  color: string;
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
  content: string;
  ttl?: string;
  prio?: string;
}

export interface UpdateNameserversRequest {
  ns: string[];
}

export class PorkbunAPI {
  private apiKey: string;
  private secretApiKey: string;
  private axiosInstance: AxiosInstance;

  constructor(credentials: Credentials) {
    this.apiKey = credentials.apiKey;
    this.secretApiKey = credentials.secretApiKey;

    this.axiosInstance = axios.create({
      baseURL: "https://porkbun.com/api/json/v3",
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Retry failed requests
    axiosRetry(this.axiosInstance, {
      retries: 10,
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
          error.response?.status === 400 || // Bad Request
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

  private async post<T>(path: string, data: object = {}): Promise<T> {
    const response = await this.axiosInstance.post(path, {
      ...data,
      apikey: this.apiKey,
      secretapikey: this.secretApiKey,
    });

    if (response.data.status !== "SUCCESS") {
      console.error(response);
      throw new Error(response.data.message);
    }
    return response.data;
  }

  async ping(): Promise<PingResponse> {
    return this.post<PingResponse>("/ping");
  }

  async listDomains(): Promise<ListDomainsResponse> {
    return this.post<ListDomainsResponse>("/domain/listAll");
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

function getDelay(retryCount: number): number {
  // Retry in 5 minutes the first time
  if (retryCount === 1) {
    return 5 * 60 * 1000;
  }

  // Retry in 1 minute for each additional retry
  return 60 * 1000;
}
