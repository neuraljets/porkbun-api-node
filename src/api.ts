import axios, { AxiosInstance } from "axios";

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
  }

  private async post<T>(path: string, data: object = {}): Promise<T> {
    const response = await this.axiosInstance.post(path, {
      ...data,
      apikey: this.apiKey,
      secretapikey: this.secretApiKey,
    });
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

  async editDNSRecords(
    request: DNSWriteRequest,
    update: EditDNSRecordRequest
  ): Promise<{ status: string }> {
    if ("type" in request) {
      const url =
        "subdomain" in request
          ? `/dns/editByNameType/${request.domain}/${request.type}/${request.subdomain}`
          : `/dns/editByNameType/${request.domain}/${request.type}`;
      return this.post<{ status: string }>(url);
    }

    const url = request.id
      ? `/dns/edit/${request.domain}/${request.id}`
      : `/dns/edit/${request.domain}`;
    return this.post<{ status: string }>(url, update);
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

    const url = request.id
      ? `/dns/delete/${request.domain}/${request.id}`
      : `/dns/delete/${request.domain}`;
    return this.post<{ status: string }>(url);
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
}
