import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, forkJoin, map, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class StockService {

  private stockArray: any[] = [];

  constructor(private httpClient: HttpClient) {
    this.refreshStocks();
  }

  async refreshStocks() {
    this.stockArray = await firstValueFrom(this.httpClient.get<any[]>('api/stocks'));
  }

  getAllStocks() {
    return this.stockArray;
  }

  // ------------ CRÉATION -------------------------------------------------

  addStock(stockSent: any) {
    const stock: any = {
      product:      stockSent.product,
      alitracer:    stockSent.alitracer,
      reference:    stockSent.reference,
      available:    true,
      status:       1,
      creationDate: new Date(),
      emplacement:  stockSent.emplacement ?? null,
      lockerNumber: stockSent.lockerNumber ?? null
    };

    // Propager la zone (Atelier) si présente
    if (stockSent.zone) {
      stock.zone = stockSent.zone;          // { id: X }
    } else {
      stock.zone = null;
    }

    console.log('HTTP CREATE payload vers /stocks :', JSON.stringify(stock));

    this.httpClient.post('api/stocks', stock).subscribe(() => {
      this.refreshStocks();
    });
  }

  // ------------ MISE À JOUR ----------------------------------------------

  updateStock(stockSent: any) {
    const stock: any = {
      id:           stockSent.id,
      available:    stockSent.available,
      status:       stockSent.status,
      alitracer:    stockSent.alitracer,
      reference:    stockSent.reference,
      emplacement:  stockSent.emplacement ?? null,
      lockerNumber: stockSent.lockerNumber ?? null
    };

    // Propager aussi la zone choisie en édition
    if (stockSent.zone) {
      stock.zone = stockSent.zone;          // { id: X }
    } else {
      stock.zone = null;
    }

    console.log('HTTP UPDATE payload vers /stocks :', JSON.stringify(stock));

    this.httpClient.post('api/stocks', stock).subscribe((stockReceived: any) => {
      this.stockArray = this.stockArray.map(p =>
        p.id === stockReceived.id ? stockReceived : p
      );
    });
  }

  // ------------ SUPPRESSION + HISTORIQUES --------------------------------

  removeChecksAndHistories(productId: number): void {
    forkJoin({
      checks:    this.getCheckIdByStockId(productId),
      histories: this.getHistoryIdByStockId(productId)
    }).subscribe(({ checks, histories }) => {
      if (checks.length === 0 && histories.length === 0) {
        this.removeStock(productId);
        return;
      }

      const deleteChecksRequests    = checks.map((c: any) => this.httpClient.delete(`api/checks/${c.id}`));
      const deleteHistoriesRequests = histories.map((h: any) => this.httpClient.delete(`api/history/${h.id}`));

      forkJoin([...deleteChecksRequests, ...deleteHistoriesRequests]).subscribe({
        next:  () => this.removeStock(productId),
        error: (err) => console.error('Erreur suppression checks/histories :', err)
      });
    });
  }

  removeStock(id: number) {
    this.stockArray = this.stockArray.filter(stock => stock.id !== id);
    this.httpClient.delete('api/stocks/' + id).subscribe(() => {
      this.refreshStocks();
    });
  }

  // ------------ LECTURE / HELPERS ----------------------------------------

  getStockById(id: number) {
    return this.stockArray.find(stock => stock.id == id);
  }

  getStockByAlitracer(alitracer: string) {
    return this.stockArray.find(stock => stock.product.alitracer === alitracer);
  }

  getStockByProductId(id: number) {
    return this.httpClient.get('api/stocks/getStockByProductId/' + id).toPromise();
  }

  getStockIdByProductId(productId: number): Observable<any[]> {
    return this.httpClient.get<any[]>('api/stocks').pipe(
      map((stocks: any[]) => stocks.filter(stock => stock.product.id === productId))
    );
  }

  getCheckIdByStockId(stockId: number): Observable<any[]> {
    return this.httpClient.get<any[]>('api/checks/getCheckByStockId/' + stockId);
  }

  getHistoryIdByStockId(stockId: number): Observable<any[]> {
    return this.httpClient.get<any[]>('api/history').pipe(
      map((items: any[]) => items.filter(item => item.stock.id == stockId))
    );
  }

  getAllChecksByStocks(): Observable<{ [stockId: number]: any[] }> {
    return this.httpClient.get<{ [stockId: number]: any[] }>('api/checks/all-by-stocks');
  }

  static getAlitracerList(stock: any): string[] {
    if (!stock?.alitracer) return [];
    return stock.alitracer.split('|').map((a: string) => a.trim()).filter((a: string) => a !== '');
  }

  static matchesAlitracer(stock: any, scannedAlitracer: string): boolean {
    const list = StockService.getAlitracerList(stock);
    return list.some(a => a === scannedAlitracer.trim());
  }

  static findByAlitracer(stocks: any[], scannedAlitracer: string): any | undefined {
    return stocks.find(s => StockService.matchesAlitracer(s, scannedAlitracer));
  }
}
