import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface Zone {
  id?: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

@Injectable({
  providedIn: 'root'
})
export class ZoneService {

  private zoneArray: Zone[] = [];

  constructor(private httpClient: HttpClient) {
    this.refreshZones();
  }

  async refreshZones() {
    this.zoneArray = await firstValueFrom(
      this.httpClient.get<Zone[]>('api/zones')
    );
  }

  getAllZones(): Zone[] {
    return this.zoneArray;
  }

  async createZone(zoneForm: Zone): Promise<void> {
    const zoneToSend: Omit<Zone, 'id'> = {
      name: zoneForm.name,
      x: zoneForm.x,
      y: zoneForm.y,
      w: zoneForm.w,
      h: zoneForm.h
    };

    const created = await firstValueFrom(
      this.httpClient.post<Zone>('api/zones', zoneToSend)
    );

    this.zoneArray.push(created);
  }

  async updateZone(zoneForm: Zone): Promise<void> {
    if (!zoneForm.id) {
      throw new Error('updateZone: id manquant');
    }

    const toSend: Zone = {
      id:   zoneForm.id,
      name: zoneForm.name,
      x:    zoneForm.x,
      y:    zoneForm.y,
      w:    zoneForm.w,
      h:    zoneForm.h
    };

    // Ton back fait createOrUpdate sur POST /zones
    const updated = await firstValueFrom(
      this.httpClient.post<Zone>('api/zones', toSend)
    );

    this.zoneArray = this.zoneArray.map(z =>
      z.id === updated.id ? updated : z
    );
  }

  async deleteZone(id: number): Promise<void> {
    await firstValueFrom(
      this.httpClient.delete<void>('api/zones/' + id)
    );
    this.zoneArray = this.zoneArray.filter(z => z.id !== id);
  }
}
