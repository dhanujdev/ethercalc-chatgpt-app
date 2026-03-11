import { parseCsv, stringifyCsv } from "./csv-utils.js";

export class EtherCalcClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  roomUrl(sheetId, suffix = "") {
    return `${this.baseUrl}/_/${encodeURIComponent(sheetId)}${suffix}`;
  }

  viewUrl(sheetId) {
    return `${this.baseUrl}/${encodeURIComponent(sheetId)}`;
  }

  async getCsv(sheetId) {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(sheetId)}.csv`);
    if (!response.ok) throw new Error(`Failed to fetch sheet CSV (${response.status})`);
    return response.text();
  }

  async getTable(sheetId) {
    return parseCsv(await this.getCsv(sheetId));
  }

  async putCsv(sheetId, csvText) {
    const response = await fetch(this.roomUrl(sheetId), {
      method: "PUT",
      headers: { "content-type": "text/csv" },
      body: csvText,
    });
    if (!response.ok) throw new Error(`Failed to write sheet (${response.status})`);
    return true;
  }

  async putTable(sheetId, table) {
    return this.putCsv(sheetId, stringifyCsv(table));
  }

  async createSheet({ sheetId, table }) {
    if (sheetId) {
      await this.putTable(sheetId, table);
      return { sheetId, url: this.viewUrl(sheetId) };
    }

    const response = await fetch(`${this.baseUrl}/_`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: stringifyCsv(table),
      redirect: "manual",
    });
    if (![200, 201, 302].includes(response.status)) {
      throw new Error(`Failed to create sheet (${response.status})`);
    }
    const location = response.headers.get("location") ?? "";
    const derivedId = location.split("/").filter(Boolean).pop();
    if (!derivedId) throw new Error("EtherCalc did not return a sheet location.");
    return { sheetId: decodeURIComponent(derivedId), url: this.viewUrl(derivedId) };
  }

  async postCommand(sheetId, commandText) {
    const response = await fetch(this.roomUrl(sheetId), {
      method: "POST",
      headers: { "content-type": "text/x-socialcalc" },
      body: commandText,
    });
    if (!response.ok) throw new Error(`Failed to post command (${response.status})`);
    return true;
  }

  async getCells(sheetId) {
    const response = await fetch(this.roomUrl(sheetId, "/cells"));
    if (!response.ok) throw new Error(`Failed to fetch cells (${response.status})`);
    return response.json();
  }
}
