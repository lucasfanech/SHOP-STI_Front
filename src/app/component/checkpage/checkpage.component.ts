import { Component, OnInit, OnDestroy } from '@angular/core';
import { NgForOf, NgIf, NgClass, DatePipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';

import {
  faListCheck, faFileExcel, faDoorOpen, faBarcode,
  faStop, faShieldAlt, faUser, faChevronLeft, faBoxesStacked
} from '@fortawesome/free-solid-svg-icons';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

import { CheckService } from '../../services/check.service';
import { StockService } from '../../services/stock.service';
import { AuthAppService } from '../../services/auth-app.service';
import { PdfService, CheckPdfData } from '../../services/pdf.service';
import { ScanService } from '../../services/scan.service';
import { ScanSocketService } from '../../services/scan-socket.service';
import { Subscription } from 'rxjs';
import { ExcelService } from '../../services/excel.service';
import { HttpClient } from '@angular/common/http';
import { LockerGridComponent } from '../locker-grid/locker-grid.component';

interface Product {
  title: string;
  type: string;
  size: string;
  cmu: string;
  location: string;
  picture: string;
  brand: string;
}

interface Stock {
  reference: string;
  id: number;
  alitracer: string;
  lockerNumber: number | null;
  emplacement: string | null;
  zone: { id: number; name: string } | null;
  status: number | null;
  lastCheckDate: string | null;
  lastRegulatoryCheckDate: string | null;
  product: Product;
}

interface LockerStats {
  withStock: number;
  empty: number;
  total: number;
}

interface LockerInfo {
  hasStock: boolean;
  needsCheck: boolean;
  ratio: string;
  firstStock: { size: string; cmu: string } | null;
}

interface MonthData {
  name: string;
  filename: string;
  file: any | null;
  month: number;
  isCurrent: boolean;
  isPast: boolean;
}

interface ProductFilter {
  title: string;
  picture: string;
}

@Component({
  selector: 'app-checkpage',
  standalone: true,
  imports: [
    NgForOf, NgIf, NgClass, DatePipe,
    ReactiveFormsModule, FormsModule,
    ToastModule, DialogModule,
    FaIconComponent, RouterLink, LockerGridComponent
  ],
  templateUrl: './checkpage.component.html',
  styleUrls: ['./checkpage.component.css'],
  providers: [MessageService]
})
export class CheckpageComponent implements OnInit, OnDestroy {

  allStocks: Stock[] = [];
  lockersMap: { [lockerNumber: number]: LockerInfo | undefined } = {};
  stats: LockerStats = { withStock: 0, empty: 0, total: 24 };
  dataReady = false;

  productFilters: ProductFilter[] = [];
  filterCounts: { [title: string]: number } = {};
  activeFilterTitle: string | null = null;
  filteredLockers: number[] = Array.from({ length: 24 }, (_, i) => i + 1);

  /** Regroupement des stocks par casier, reconstruit en un seul passage à chaque changement de données (évite de refiltrer allStocks à chaque cycle de détection de changement Angular). */
  private lockerStocksCache = new Map<number, Stock[]>();

  activeLocker: number | null = null;
  lockerStocks: Stock[] = [];
  lockerDetailsDialogVisible = false;

  wallDetailsDialogVisible = false;
  wallStocks: Stock[] = [];

  // Choix du type de contrôle réglementaire
  regulatoryTypeDialogVisible = false;
  regulatoryOrganization: 'CLASSIC' | 'APAVE' = 'CLASSIC';

  selectedStockForCheck: Stock | null = null;
  checkComment = '';
  checkDialogVisible = false;
  lockerCloseDialogVisible = false;

  monthlyExcelFiles: any[] = [];
  selectedYear: number | null = null;
  yearDetailDialogVisible = false;

  scanDialogVisible = false;
  globalControlMode = false;
  isTotalControlMode = false;
  pendingCheckType: 'REGULATORY' | 'INDIVIDUAL' = 'INDIVIDUAL';

  lockersOpenedForControl: number[] = [];
  expectedAlitracers: string[] = [];
  lockerOpenProgress = '';

  manualSuffix = '';
  manualScanError = '';
  protected isProcessing = false;

  hsWarningDialogVisible = false;
  hsWarningStock: Stock | null = null;

  recentActions: { action: string; locker: number; time: Date }[] = [];
  private readonly PLC_POLLING_DELAY = 800;
  private actionTimeout: any;
  private scanSubscription?: Subscription;
  readonly currentYear = new Date().getFullYear();

  protected readonly faListCheck = faListCheck;
  protected readonly faFileExcel = faFileExcel;
  protected readonly faDoorOpen = faDoorOpen;
  protected readonly faBarcode = faBarcode;
  protected readonly faStop = faStop;
  protected readonly faShieldAlt = faShieldAlt;
  protected readonly faUser = faUser;
  protected readonly faChevronLeft = faChevronLeft;
  protected readonly faBoxesStacked = faBoxesStacked;

  constructor(
    private checkService: CheckService,
    private messageService: MessageService,
    private stockService: StockService,
    private authApp: AuthAppService,
    private pdfService: PdfService,
    private scanService: ScanService,
    private scanSocketService: ScanSocketService,
    private httpClient: HttpClient,
    private excelService: ExcelService
  ) {
    for (let num = 1; num <= 24; num++) {
      this.lockersMap[num] = { hasStock: false, needsCheck: false, ratio: '', firstStock: null };
    }
  }

  get stocksWithoutLocker(): Stock[] {
    return this.allStocks.filter(s => s.emplacement === 'Mur');
  }

  get totalAvailableStocks(): number {
    return this.allStocks.length;
  }

  get availableYears(): number[] {
    const current = new Date().getFullYear();
    // Année courante + toutes les années passées ayant des fichiers
    const pastYears = [...new Set(
      this.monthlyExcelFiles
        .map(f => {
          const match = f.filename.match(/_(\d{4})\.xlsx$/);
          return match ? parseInt(match[1]) : null;
        })
        .filter((y): y is number => y !== null && y < current)
    )];
    return [...new Set([current, ...pastYears])].sort((a, b) => b - a);
  }

  get hasPartialRegulatoryControl(): boolean {
    const withStock = this.allStocks.filter(s => (s.lockerNumber ?? 0) > 0);
    if (withStock.length === 0) return false;
    const done = withStock.filter(s => this.isStockCheckedRegulatoryThisMonth(s)).length;
    return done > 0 && done < withStock.length;
  }

  get globalControlLabel(): string {
    return this.hasPartialRegulatoryControl ? 'Finir le Contrôle Réglementaire' : 'Contrôle Réglementaire';
  }



  get isEverythingFullyCheckedThisMonth(): boolean {
    // Vérifie tous les casiers (1-24)
    const allLockersDone = Array.from({ length: 24 }, (_, i) => i + 1).every(num => {
      const stocks = this.getStocksByLocker(num);
      return stocks.length === 0 || stocks.every(s => this.isStockCheckedRegulatoryThisMonth(s));
    });

    // Vérifie le mur
    const wallStocks = this.stocksWithoutLocker;
    const wallDone = wallStocks.length === 0 || wallStocks.every(s => this.isStockCheckedRegulatoryThisMonth(s));

    return allLockersDone && wallDone;
  }

  async ngOnInit(): Promise<void> {
    this.dataReady = false;
    await this.loadLockers();
    await this.loadLastCheckDates();
    this.buildLockersMapAndStats();
    await this.loadProductFilters();
    await this.loadMonthlyExcelFiles();
    this.dataReady = true;
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  isLoggedIn() { return this.authApp.isLoggedIn(); }
  isAdmin() { return this.authApp.isAdmin(); }
  isMaintenance() { return this.authApp.isMaintenance(); }

  get currentUserName(): string {
    const user = this.authApp.getCurrentUser();
    return user ? user.username : 'Utilisateur';
  }

  private async loadLockers(): Promise<void> {
    await this.checkService.refreshStocks();
    const rawStocks: any[] = this.checkService.getStocks();
    this.allStocks = rawStocks.map(s => ({
      id: s.id,
      alitracer: s.alitracer,
      lockerNumber: s.lockerNumber ?? null,
      emplacement: s.emplacement ?? null,
      zone: s.zone ?? null,
      reference: s.reference,
      status: s.status,
      lastCheckDate: null,
      lastRegulatoryCheckDate: null,
      product: {
        title: s.product.title,
        type: s.product.type,
        size: s.product.size,
        cmu: s.product.cmu,
        location: s.product.location,
        picture: s.product.picture,
        brand: s.product.brand
      }
    }));
  }

  private async loadLastCheckDates(): Promise<void> {
    return new Promise<void>(resolve => {
      this.stockService.getAllChecksByStocks().subscribe({
        next: (grouped) => {
          for (const stock of this.allStocks) {
            const checks: any[] = grouped[stock.id] ?? [];
            if (checks.length === 0) {
              stock.lastCheckDate = null;
              stock.lastRegulatoryCheckDate = null;
              continue;
            }
            const sorted = [...checks].sort((a, b) =>
              new Date(b.date).getTime() - new Date(a.date).getTime()
            );
            stock.lastCheckDate = this.formatDate(new Date(sorted[0].date));

            const regulatory = checks.filter(c => this.isRegulatoryCheck(c));
            if (regulatory.length > 0) {
              const latestReg = [...regulatory].sort((a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime()
              )[0];
              stock.lastRegulatoryCheckDate = this.formatDate(new Date(latestReg.date));
            } else {
              stock.lastRegulatoryCheckDate = null;
            }
          }
          resolve();
        },
        error: () => {
          for (const stock of this.allStocks) {
            stock.lastCheckDate = null;
            stock.lastRegulatoryCheckDate = null;
          }
          resolve();
        }
      });
    });
  }

  private isRegulatoryCheck(c: any): boolean {
    const ct: string | null | undefined = c.checkType ?? c.type ?? null;
    return ct !== 'INDIVIDUAL';
  }

  /**
   * Reconstruit en un seul passage sur allStocks : le regroupement par casier,
   * la carte d'état/ratio/aperçu par casier (lockersMap) et les stats globales.
   * Avant, chaque case de la grille (×24) appelait plusieurs méthodes qui
   * refiltraient allStocks à chaque cycle de détection de changement Angular
   * — d'où la latence d'affichage. Maintenant tout est précalculé une seule
   * fois ici, et le template ne fait que lire lockersMap[num].
   */
  private buildLockersMapAndStats(): void {
    this.lockerStocksCache.clear();
    for (const s of this.allStocks) {
      if (!s.lockerNumber) continue;
      const arr = this.lockerStocksCache.get(s.lockerNumber);
      if (arr) arr.push(s); else this.lockerStocksCache.set(s.lockerNumber, [s]);
    }

    const map: { [lockerNumber: number]: LockerInfo } = {};
    let withStock = 0, empty = 0;

    for (let num = 1; num <= 24; num++) {
      const stocks = this.lockerStocksCache.get(num) ?? [];
      const hasStock = stocks.length > 0;

      let needsCheckFlag = false;
      let ratio = '';
      let firstStock: LockerInfo['firstStock'] = null;

      if (hasStock) {
        const done = stocks.filter(s => this.isStockCheckedRegulatoryThisMonth(s)).length;
        ratio = `${done}/${stocks.length}`;
        needsCheckFlag = done < stocks.length;
        firstStock = { size: stocks[0].product.size, cmu: stocks[0].product.cmu };
        withStock++;
      } else {
        empty++;
      }

      map[num] = { hasStock, needsCheck: needsCheckFlag, ratio, firstStock };
    }

    this.lockersMap = map;
    this.stats = { withStock, empty, total: 24 };
    this.setFilter(this.activeFilterTitle);
  }

  async refreshLockers(): Promise<void> {
    this.dataReady = false;
    await this.loadLockers();
    await this.loadLastCheckDates();
    this.buildLockersMapAndStats();
    await this.loadProductFilters();
    await this.loadMonthlyExcelFiles();
    this.dataReady = true;
  }

  private async loadProductFilters(): Promise<void> {
    try {
      const procs = await this.httpClient.get<any[]>('api/procedures').toPromise() ?? [];
      const usedTitles = new Set(this.allStocks.map(s => s.product.title));
      const seen = new Set<string>();
      this.productFilters = procs
        .filter(p => p.title && usedTitles.has(p.title) && !seen.has(p.title) && seen.add(p.title))
        .map(p => ({ title: p.title as string, picture: (p.picture as string) ?? '' }));
    } catch {
      const seen = new Set<string>();
      this.productFilters = [];
      for (const s of this.allStocks) {
        if ((s.lockerNumber ?? 0) > 0 && !seen.has(s.product.title)) {
          seen.add(s.product.title);
          this.productFilters.push({ title: s.product.title, picture: s.product.picture ?? '' });
        }
      }
    }

    // lockerStocksCache a déjà été reconstruit par buildLockersMapAndStats() juste avant.
    // Le Mur compte pour 1 emplacement supplémentaire s'il contient le produit
    // (sinon un produit uniquement sur le Mur affichait "0 casier(s)").
    const counts: { [title: string]: number } = {};
    for (const filter of this.productFilters) {
      let count = 0;
      for (let num = 1; num <= 24; num++) {
        if ((this.lockerStocksCache.get(num) ?? []).some(s => s.product.title === filter.title)) count++;
      }
      if (this.stocksWithoutLocker.some(s => s.product.title === filter.title)) count++;
      counts[filter.title] = count;
    }
    this.filterCounts = counts;
  }

  setFilter(title: string | null): void {
    this.activeFilterTitle = title;
    if (!title) {
      this.filteredLockers = Array.from({ length: 24 }, (_, i) => i + 1);
      return;
    }
    const result: number[] = [];
    for (let num = 1; num <= 24; num++) {
      if ((this.lockerStocksCache.get(num) ?? []).some(s => s.product.title === title)) result.push(num);
    }
    this.filteredLockers = result;
  }

  getLockerCountByTitle(title: string): number {
    return this.filterCounts[title] ?? 0;
  }

  getStocksByLocker(lockerNumber: number): Stock[] {
    return this.lockerStocksCache.get(lockerNumber) ?? [];
  }

  getWallStocks(): Stock[] {
    return this.stocksWithoutLocker;
  }

  getAlitracerList(stock: Stock): string[] {
    return StockService.getAlitracerList(stock);
  }

  getWallCheckRatio(): string {
    const stocks = this.stocksWithoutLocker;
    if (stocks.length === 0) return '';
    const done = stocks.filter(s => this.isStockCheckedRegulatoryThisMonth(s)).length;
    return `${done}/${stocks.length}`;
  }

  openLockerDetails(lockerNumber: number): void {
    this.activeLocker = lockerNumber;
    this.lockerStocks = this.getStocksByLocker(lockerNumber);
    this.lockerDetailsDialogVisible = true;
  }

  openWallDetails(): void {
    this.wallStocks = [...this.stocksWithoutLocker];
    this.wallDetailsDialogVisible = true;
  }

  wallNeedsCheck(): boolean {
    const stocks = this.stocksWithoutLocker;
    return stocks.length > 0 && stocks.some(s => !this.isStockCheckedRegulatoryThisMonth(s));
  }

  wallMatchesActiveFilter(): boolean {
    if (!this.activeFilterTitle) return true;
    return this.stocksWithoutLocker.some(s => s.product.title === this.activeFilterTitle);
  }

  isLockerFullyCheckedRegulatoryThisMonth(lockerNumber: number): boolean {
    const stocks = this.getStocksByLocker(lockerNumber);
    if (stocks.length === 0) return false;
    return stocks.every(s => this.isStockCheckedRegulatoryThisMonth(s));
  }

  isWallFullyCheckedRegulatoryThisMonth(): boolean {
    const stocks = this.stocksWithoutLocker;
    if (stocks.length === 0) return false;
    return stocks.every(s => this.isStockCheckedRegulatoryThisMonth(s));
  }

  isStockCheckedRegulatoryThisMonth(stock: Stock): boolean {
    return this.isDateThisMonth(stock.lastRegulatoryCheckDate);
  }

  isStockCheckedThisMonth(stock: Stock): boolean {
    return this.isDateThisMonth(stock.lastCheckDate);
  }

  private isDateThisMonth(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const parts = dateStr.split(/[\\s/:-]/);
    if (parts.length < 3) return false;
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  private getLockersNeedingRegulatoryCheck(): number[] {
    const result: number[] = [];
    for (let num = 1; num <= 24; num++) {
      const stocks = this.getStocksByLocker(num);
      if (stocks.length > 0 && !this.isLockerFullyCheckedRegulatoryThisMonth(num)) result.push(num);
    }
    return result;
  }

  getStatusClass(stock: any): string {
    if (stock.status === 1) return 'text-green-500 font-bold';
    if (stock.status === 0) return 'text-black font-bold';
    if (stock.status === 2) return 'text-red-600 font-bold';
    return 'text-gray-500';
  }

  getStatusLabelFromStock(stock: Stock): string {
    if (stock.status === 1) return 'OK';
    if (stock.status === 0) return 'NOK';
    if (stock.status === 2) return 'HS';
    return 'Inconnu';
  }

  getStatusClassFromStock(stock: Stock): string {
    switch (stock.status) {
      case 1: return 'text-green-500 font-bold';
      case 0: return 'text-orange-500 font-bold';
      case 2: return 'text-red-600 font-bold';
      default: return 'text-gray-500';
    }
  }

  private async loadMonthlyExcelFiles(): Promise<void> {
    try { this.monthlyExcelFiles = await this.excelService.getMonthlyFiles(); } catch {}
  }

  getFilesByYear(year: number): any[] {
    return this.monthlyExcelFiles.filter(f => f.filename.includes(`_${year}.xlsx`));
  }

  getMonthsForYear(year: number): MonthData[] {
    const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const now = new Date();
    return MONTHS.map((name, index) => {
      const filename = `Controle_${name}_${year}.xlsx`;
      const file = this.monthlyExcelFiles.find(f => f.filename === filename) ?? null;
      return {
        name, filename, file, month: index + 1,
        isCurrent: year === now.getFullYear() && index === now.getMonth(),
        isPast: new Date(year, index + 1, 0) < new Date(now.getFullYear(), now.getMonth(), 1)
      };
    });
  }

  openYearDetail(year: number): void {
    this.selectedYear = year;
    this.yearDetailDialogVisible = true;
  }

  async downloadCurrentMonthExcel(): Promise<void> {
    const now = new Date();
    const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    await this.downloadMonthlyExcel(`Controle_${MONTHS[now.getMonth()]}_${now.getFullYear()}.xlsx`);
  }

  async downloadMonthlyExcel(filename: string): Promise<void> {
    try {
      const blob = await this.excelService.downloadMonthlyExcel(filename);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      window.URL.revokeObjectURL(url);
      this.messageService.add({
        severity: 'success', summary: 'Téléchargement réussi',
        detail: `${filename} téléchargé.`
      });
    } catch {
      this.showErrorToast('Erreur lors du téléchargement');
    }
  }

  private async updateMonthlyExcel(stock: Stock, status: number, comment: string, username: string): Promise<void> {
    try {
      await this.excelService.updateMonthlyExcel({
        alitracer: stock.alitracer,
        size: stock.product.size,
        cmu: stock.product.cmu,
        location: this.formatStockLocation(stock),
        status,
        comment,
        controlledBy: username,
        date: new Date().toISOString()
      });
    } catch {}
  }

  /** "Casier X" si l'outil est dans un casier, sinon le nom de la zone atelier. */
  private formatStockLocation(stock: Stock): string {
    if (stock.lockerNumber) return `Casier ${stock.lockerNumber}`;
    return stock.zone?.name || stock.emplacement || 'N/A';
  }

  async startGlobalControl(): Promise<void> {
    if (this.isEverythingFullyCheckedThisMonth) {
      this.messageService.add({
        severity: 'success',
        summary: 'Tous les contrôles ont été effectués',
        detail: 'Tous les casiers et le stock mural ont déjà été contrôlés réglementairement ce mois-ci. ✅'
      });
      return;
    }

    // On ouvre d’abord le popup de choix (Classique / Apave)
    this.regulatoryTypeDialogVisible = true;
  }

  async confirmRegulatoryType(isApave: boolean): Promise<void> {
    this.regulatoryTypeDialogVisible = false;
    this.regulatoryOrganization = isApave ? 'APAVE' : 'CLASSIC';

    // À partir d’ici, c’est exactement ton ancien startGlobalControl (procédure classique)
    const lockersNeeding = this.getLockersNeedingRegulatoryCheck();
    this.stopPolling();

    if (lockersNeeding.length > 0) {
      this.lockerOpenProgress = '...';
      this.messageService.add({
        severity: 'info',
        summary: 'Ouverture en cours',
        detail: `Envoi batch vers ${lockersNeeding.length} casier(s)...`
      });
      try {
        const result = await new Promise<{ requested: number[]; succeeded: number[]; failed: number[] }>(
          (resolve, reject) => this.scanService.openLockers(lockersNeeding)
            .subscribe({ next: resolve, error: reject })
        );
        this.lockerOpenProgress = '';
        this.lockersOpenedForControl = result.succeeded;
        if (result.succeeded.length === 0) {
          this.showErrorToast("Aucun casier n'a pu être ouvert.");
          return;
        }
        if (result.failed.length > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Ouverture partielle',
            detail: `${result.succeeded.length}/${lockersNeeding.length} ouvert(s). Ignorés : ${result.failed.join(', ')}.`
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Casiers ouverts',
            detail: `${result.succeeded.length} casier(s) ouvert(s).`
          });
        }
        result.succeeded.forEach(n => this.addRecentAction('Ouverture réglementaire', n));
      } catch {
        this.lockerOpenProgress = '';
        this.showErrorToast("Erreur lors de l'ouverture des casiers");
        return;
      }
    } else {
      this.lockersOpenedForControl = [];
      this.messageService.add({
        severity: 'info',
        summary: 'Contrôle mural',
        detail: 'Aucun casier à ouvrir — seuls les stocks du mur sont à contrôler.'
      });
    }

    this.expectedAlitracers = this.allStocks
      .filter(s =>
        (s.lockerNumber ?? 0) > 0 &&
        this.lockersOpenedForControl.includes(s.lockerNumber as number) &&
        !this.isStockCheckedRegulatoryThisMonth(s)
      )
      .flatMap(s => StockService.getAlitracerList(s));

    this.expectedAlitracers.push(
      ...this.stocksWithoutLocker
        .filter(s => !this.isStockCheckedRegulatoryThisMonth(s))
        .flatMap(s => StockService.getAlitracerList(s))
    );

    this.globalControlMode = true;
    this.isTotalControlMode = false;
    this.activeLocker = null;
    this.scanDialogVisible = true;
    await new Promise(r => setTimeout(r, this.PLC_POLLING_DELAY));
    this.startPolling();
  }

  async startTotalControl(): Promise<void> {
    this.stopPolling();
    this.lockersOpenedForControl = [];
    const lockersWithStock: number[] = [];
    for (let num = 1; num <= 24; num++) {
      if (this.getStocksByLocker(num).length > 0) lockersWithStock.push(num);
    }
    if (lockersWithStock.length > 0) {
      this.lockerOpenProgress = '...';
      this.messageService.add({
        severity: 'info',
        summary: 'Ouverture en cours',
        detail: `Ouverture de ${lockersWithStock.length} casier(s)...`
      });
      try {
        const result = await new Promise<{ requested: number[]; succeeded: number[]; failed: number[] }>(
          (resolve, reject) => this.scanService.openLockers(lockersWithStock)
            .subscribe({ next: resolve, error: reject })
        );
        this.lockerOpenProgress = '';
        this.lockersOpenedForControl = result.succeeded;
        result.succeeded.forEach(n => this.addRecentAction('Ouverture Tout Contrôler', n));
        if (result.failed.length > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Ouverture partielle',
            detail: `${result.succeeded.length}/${lockersWithStock.length} ouvert(s). Ignorés : ${result.failed.join(', ')}.`
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Casiers ouverts',
            detail: `${result.succeeded.length} casier(s) ouvert(s).`
          });
        }
      } catch {
        this.lockerOpenProgress = '';
        this.showErrorToast("Erreur lors de l'ouverture des casiers");
        return;
      }
    }

    this.expectedAlitracers = this.allStocks
      .filter(s => this.isControllableStock(s))
      .flatMap(s => StockService.getAlitracerList(s));

    this.globalControlMode = false;
    this.isTotalControlMode = true;
    this.activeLocker = null;
    this.scanDialogVisible = true;
    await new Promise(r => setTimeout(r, this.PLC_POLLING_DELAY));
    this.startPolling();
  }
  private isControllableStock(stock: Stock): boolean {
    return stock.emplacement !== 'Atelier';
  }

  async startScanControl(): Promise<void> {
    if (!this.activeLocker) { this.showErrorToast('Aucun casier sélectionné'); return; }
    if (this.lockerStocks.length === 0) { this.showErrorToast('Aucun stock à contrôler dans ce casier'); return; }
    try {
      await this.scanService.openLocker(this.activeLocker);
      this.addRecentAction('Ouverture individuelle', this.activeLocker);
      this.messageService.add({
        severity: 'info',
        summary: 'Casier ouvert',
        detail: `Casier ${this.activeLocker} ouvert. Contrôle individuel démarré.`
      });
      this.globalControlMode = false;
      this.isTotalControlMode = false;
      this.expectedAlitracers = this.lockerStocks.flatMap(s => StockService.getAlitracerList(s));
      this.lockerDetailsDialogVisible = false;
      this.scanDialogVisible = true;
      this.startPolling();
    } catch {
      this.showErrorToast(`Impossible d'ouvrir le casier ${this.activeLocker}`);
    }
  }

  startWallScanControl(): void {
    this.wallDetailsDialogVisible = false;
    this.activeLocker = null;
    this.lockerStocks = [...this.stocksWithoutLocker];
    this.expectedAlitracers = this.lockerStocks.flatMap(s => StockService.getAlitracerList(s));
    this.globalControlMode = false;
    this.isTotalControlMode = false;
    this.checkComment = '';
    this.manualSuffix = '';
    this.manualScanError = '';
    this.scanDialogVisible = true;
    this.startPolling();
  }

  async stopScanControl(): Promise<void> {
    this.stopPolling();
    this.scanDialogVisible = false;

    // Mode réglementaire ou "Tout Contrôler" : fermer les casiers batch
    if ((this.globalControlMode || this.isTotalControlMode) && this.lockersOpenedForControl.length > 0) {
      this.lockerCloseDialogVisible = true;
    } else if (this.activeLocker !== null) {
      // Mode casier individuel
      this.lockerCloseDialogVisible = true;
    } else {
      // Mode mur seul : pas de casier à fermer
      this.resetControlState();
      await this.refreshLockers();
    }
  }

  async confirmLockerClosed(): Promise<void> {
    this.lockerCloseDialogVisible = false;
    if (this.globalControlMode || this.isTotalControlMode) {
      this.messageService.add({
        severity: 'info',
        summary: 'Fermeture en cours',
        detail: 'Fermeture des casiers contrôlés...'
      });
      try {
        const result = await new Promise<{ requested: number[]; succeeded: number[]; failed: number[] }>(
          (resolve, reject) => this.scanService.closeLockers(this.lockersOpenedForControl)
            .subscribe({ next: resolve, error: reject })
        );
        result.succeeded.forEach(n => this.addRecentAction('Fermeture', n));
        if (result.failed.length > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Fermeture partielle',
            detail: `Casiers non fermés : ${result.failed.join(', ')}.`
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Casiers fermés',
            detail: `${result.succeeded.length} casier(s) fermé(s).`
          });
        }
      } catch {
        this.showErrorToast('Erreur lors de la fermeture des casiers');
      }
      this.lockersOpenedForControl = [];
    } else if (this.activeLocker !== null) {
      try {
        await this.scanService.closeLocker(this.activeLocker);
        this.addRecentAction('Fermeture individuelle', this.activeLocker);
        this.messageService.add({
          severity: 'success',
          summary: 'Casier fermé',
          detail: `Casier ${this.activeLocker} fermé.`
        });
      } catch {
        this.showErrorToast(`Impossible de fermer le casier ${this.activeLocker}`);
      }
    }
    this.resetControlState();
    await this.refreshLockers();
  }

  private resetControlState(): void {
    this.activeLocker = null;
    this.selectedStockForCheck = null;
    this.globalControlMode = false;
    this.isTotalControlMode = false;
    this.pendingCheckType = 'INDIVIDUAL';
    this.messageService.add({
      severity: 'info',
      summary: 'Contrôle terminé',
      detail: 'Le mode de contrôle a été arrêté.'
    });
  }

  private startPolling(): void {
    this.scanSubscription = this.scanSocketService.scan$.subscribe(async response => {
      if (this.isProcessing) return;
      try {
        if (response?.success && response?.value) {
          const val = response.value.trim();
          if (val !== '') {
            this.isProcessing = true;
            await this.handleScannedCode(val);
          }
        }
      } catch {
        this.isProcessing = false;
      }
    });
  }

  private stopPolling(): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
    this.isProcessing = false;
  }

  submitManualScan(): void {
    const suffix = this.manualSuffix.trim();
    if (!/^\d{4}$/.test(suffix)) {
      this.manualScanError = 'Saisissez exactement 4 chiffres.';
      return;
    }
    this.manualScanError = '';
    this.manualSuffix = '';
    this.isProcessing = true;
    this.handleScannedCode('L000000' + suffix);
  }

  private async handleScannedCode(decodedText: string): Promise<void> {
    try {
      const alitracer = decodedText.trim();
      if (this.expectedAlitracers.length > 0 && !this.expectedAlitracers.includes(alitracer)) {
        this.messageService.add({
          severity: 'error',
          summary: 'Alitracer non attendu',
          detail: this.globalControlMode
            ? "Ce code n'est pas dans la liste des stocks à contrôler réglementairement."
            : this.isTotalControlMode
              ? "Ce code n'est pas dans la liste des stocks à contrôler."
              : this.activeLocker !== null
                ? `Ce code ne fait pas partie du casier ${this.activeLocker}.`
                : "Ce code ne fait pas partie des stocks hors casier."
        });
        return;
      }
      const stock = StockService.findByAlitracer(this.allStocks, alitracer);
      if (!stock) {
        this.messageService.add({
          severity: 'error',
          summary: 'Stock introuvable',
          detail: "Aucun stock trouvé pour l'ID Alitracer scanné."
        });
        return;
      }
      this.pendingCheckType = this.globalControlMode ? 'REGULATORY' : 'INDIVIDUAL';
      this.selectedStockForCheck = stock;
      this.checkComment = '';
      this.checkDialogVisible = true;
      this.stopPolling();
    } catch {
      this.showErrorToast('Une erreur est survenue lors du traitement du scan.');
    } finally {
      await this.scanService.clearScan();
      await new Promise(r => setTimeout(r, 1000));
      this.isProcessing = false;
    }
  }

  confirmCheck(status: number): void {
    this.checkDialogVisible = false;
    this.executeCheck(status);
  }

  private async executeCheck(status: number): Promise<void> {
    if (!this.selectedStockForCheck) { this.showErrorToast('Aucun produit sélectionné'); return; }
    const appUser = this.authApp.getCurrentUser();
    if (!appUser) { this.showErrorToast('Vous devez être connecté pour réaliser un contrôle'); return; }

    const checkType = this.pendingCheckType;
    const checkDate = new Date().toISOString();

    // Si c’est un contrôle réglementaire Apave, préremplir le commentaire
    if (checkType === 'REGULATORY' && this.regulatoryOrganization === 'APAVE') {
      if (!this.checkComment || this.checkComment.trim().length === 0) {
        this.checkComment = 'Contrôle Apave';
      } else if (!this.checkComment.includes('Contrôle Apave')) {
        this.checkComment = `${this.checkComment} - Contrôle Apave`;
      }
    }

    const payload: any = {
      id: null, date: checkDate, status,
      comment: this.checkComment || '', checkType,
      user: { id: appUser.id }, stock: { id: this.selectedStockForCheck.id }
    };

    try {
      const savedCheck: any = await this.checkService.createCheck(payload);

      const pdfData: CheckPdfData = {
        checkDate,
        productName: this.selectedStockForCheck.product?.title || 'Produit inconnu',
        alitracer: this.selectedStockForCheck.alitracer || '',
        reference: this.selectedStockForCheck.reference || '',
        lockerNumber: this.selectedStockForCheck.lockerNumber ?? 0,
        status,
        comment: this.checkComment || '',
        controlledBy: appUser.username,
        brand: this.selectedStockForCheck.product?.brand || 'N/A',
        cmu: this.selectedStockForCheck.product?.cmu || 'N/A',
        size: this.selectedStockForCheck.product?.size || 'N/A'
      };

      const pdfResult: any = await this.pdfService.generateAndSavePdf(pdfData);
      if (pdfResult?.filename) {
        await this.httpClient.patch(`api/checks/${savedCheck.id}/pdf`, {}, { params: { filename: pdfResult.filename } }).toPromise();
      }

      if (checkType === 'REGULATORY') {
        await this.updateMonthlyExcel(this.selectedStockForCheck, status, this.checkComment, appUser.username);
      }

      const formatted = this.formatDate(new Date());
      this.selectedStockForCheck.status = status;
      this.selectedStockForCheck.lastCheckDate = formatted;

      const alitracersOfStock = StockService.getAlitracerList(this.selectedStockForCheck);

      if (checkType === 'REGULATORY') {
        this.selectedStockForCheck.lastRegulatoryCheckDate = formatted;
        this.expectedAlitracers = this.expectedAlitracers.filter(a => !alitracersOfStock.includes(a));
      } else if (this.isTotalControlMode || this.activeLocker === null) {
        this.expectedAlitracers = this.expectedAlitracers.filter(a => !alitracersOfStock.includes(a));
      }

      const inList = this.allStocks.find(s => s.id === this.selectedStockForCheck!.id);
      if (inList) {
        inList.status = status;
        inList.lastCheckDate = formatted;
        if (checkType === 'REGULATORY') inList.lastRegulatoryCheckDate = formatted;
      }

      this.buildLockersMapAndStats();
      if (checkType === 'REGULATORY') await this.loadMonthlyExcelFiles();
      this.showAddToast(checkType);

      if (status === 2) {
        try {
          await this.httpClient.patch(`api/stocks/${this.selectedStockForCheck.id}/withdraw`, {}).toPromise();
        } catch (e) {
          console.error('Erreur lors du retrait du stock HS :', e);
        }

        const inListHS = this.allStocks.find(s => s.id === this.selectedStockForCheck!.id);
        if (inListHS) inListHS.lockerNumber = 0;
        this.selectedStockForCheck.lockerNumber = 0;
        this.buildLockersMapAndStats();

        this.hsWarningStock = this.selectedStockForCheck;
        this.selectedStockForCheck = null;
        this.checkComment = '';
        this.hsWarningDialogVisible = true;
        return;
      }

      this.selectedStockForCheck = null;
      this.checkComment = '';

      const isMultiMode = this.globalControlMode || this.isTotalControlMode || this.activeLocker === null;
      if (isMultiMode && this.expectedAlitracers.length === 0) {
        this.messageService.add({
          severity: 'success',
          summary: this.globalControlMode ? 'Contrôle réglementaire terminé' : 'Tout contrôlé',
          detail: this.globalControlMode
            ? 'Tous les stocks ont été contrôlés réglementairement ce mois-ci. ✅'
            : 'Tous les stocks ont été contrôlés. ✅'
        });
        setTimeout(() => this.stopScanControl(), 1500);
        return;
      }

      if (this.scanDialogVisible) {
        this.messageService.add({
          severity: 'info',
          summary: 'Contrôle enregistré',
          detail: 'Vous pouvez scanner le prochain stock.'
        });
        setTimeout(() => this.startPolling(), 500);
      } else {
        await this.refreshLockers();
      }
    } catch {
      this.showErrorToast("Erreur lors de l'enregistrement du contrôle");
    }
  }

  closeHsWarning(): void {
    this.hsWarningDialogVisible = false;
    this.hsWarningStock = null;

    if ((this.globalControlMode || this.isTotalControlMode || this.activeLocker === null)
      && this.expectedAlitracers.length === 0) {
      this.messageService.add({
        severity: 'success',
        summary: this.globalControlMode ? 'Contrôle réglementaire terminé' : 'Tout contrôlé',
        detail: 'Tous les stocks ont été contrôlés. ✅'
      });
      setTimeout(() => this.stopScanControl(), 1500);
      return;
    }

    if (this.scanDialogVisible) {
      setTimeout(() => this.startPolling(), 500);
    }
  }

  showAddToast(checkType: 'REGULATORY' | 'INDIVIDUAL' = 'INDIVIDUAL'): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Contrôle enregistré',
      detail: checkType === 'REGULATORY'
        ? 'Contrôle réglementaire enregistré — ratio et Excel mis à jour.'
        : 'Contrôle individuel enregistré — ratio et Excel non modifiés.'
    });
  }

  showErrorToast(detail = 'Erreur inconnue'): void {
    this.messageService.add({ severity: 'error', summary: 'Erreur', detail });
  }

  private formatDate(date: Date): string {
    return date.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  private addRecentAction(action: string, locker: number): void {
    this.recentActions.unshift({ action, locker, time: new Date() });
    if (this.recentActions.length > 5) this.recentActions = this.recentActions.slice(0, 5);
    if (this.actionTimeout) clearTimeout(this.actionTimeout);
    this.actionTimeout = setTimeout(() => { this.recentActions = []; }, 30000);
  }
}
