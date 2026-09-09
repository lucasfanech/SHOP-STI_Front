import { Component, OnInit, OnDestroy } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { CarouselModule } from 'primeng/carousel';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { faBarcode } from '@fortawesome/free-solid-svg-icons';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

import { ScanService } from '../../services/scan.service';
import { ScanSocketService } from '../../services/scan-socket.service';
import { Subscription } from 'rxjs';
import { StockService } from '../../services/stock.service';
import { CheckService } from '../../services/check.service';
import { AuthAppService } from '../../services/auth-app.service';
import { HistoryService } from '../../services/history.service';
import { ProductService } from '../../services/product.service';
import { LockerGridComponent } from '../locker-grid/locker-grid.component';

interface LockerStats { available: number; empty: number; total: number; }
interface LockerInfo {
  hasStock: boolean;
  state: 'empty' | 'allAvailable' | 'allBorrowed' | 'mixed';
  ratio: string;
  firstStock: { title: string; size: string; cmu: string } | null;
  /** true si ce casier contient le produit du filtre actif (pour l'anneau jaune). */
  matchesFilter: boolean;
}

interface ProductFilter {
  title: string;
  picture: string;
}

@Component({
  selector: 'app-scanpage',
  standalone: true,
  templateUrl: './scanpage.component.html',
  styleUrls: ['./scanpage.component.css'],
  imports: [
    NgForOf, NgIf,
    ReactiveFormsModule, FormsModule,
    CarouselModule, TagModule, ButtonModule, DialogModule, ToastModule,
    FaIconComponent, LockerGridComponent
  ],
  providers: [MessageService]
})
export class ScanpageComponent implements OnInit, OnDestroy {

  availableStocks: any[] = [];
  loanedStocks: any[] = [];
  allStocks: any[] = [];

  lockers: number[] = Array.from({ length: 24 }, (_, i) => i + 1);
  lockersMap: { [lockerNumber: number]: LockerInfo | undefined } = {};
  filterCounts: { [title: string]: number } = {};

  /** Regroupement des stocks par casier, reconstruit en un seul passage à chaque changement de données (évite de refiltrer allStocks à chaque cycle de détection de changement Angular). */
  private lockerStocksCache = new Map<number, any[]>();
  stats: LockerStats = { available: 0, empty: 0, total: 24 };

  productFilters: ProductFilter[] = [];
  activeFilterTitle: string | null = null;

  activeLocker: number | null = null;
  lockerStocks: any[] = [];
  lockerDetailsDialogVisible = false;

  withdrawDialogVisible = false;
  withdrawQuantity = 1;
  withdrawMax = 0;
  withdrawStocksPool: any[] = [];

  depositDialogVisible = false;
  depositQuantity = 1;
  depositMax = 0;
  depositStocksPool: any[] = [];

  lockerCloseDialogVisible = false;
  safetyDialogVisible = false;
  protected lockedFlow: 'withdraw' | 'deposit' | null = null;

  scanDialogVisible = false;
  scanMode: 'withdraw' | 'deposit' | null = null;
  targetScanCount = 0;
  scannedCount = 0;
  expectedAlitracers: string[] = [];

  manualSuffix = '';
  manualScanError = '';

  private scanSubscription?: Subscription;
  protected isProcessing = false;

  stock: any = {
    product: { title: '', type: '', size: '', cmu: '', location: '', picture: '', alitracer: '' },
    available: null,
    status: null,
    creationDate: null
  };
  review: any = {
    product: { title: '', type: '', size: '', cmu: '', location: '', picture: '', alitracer: '' },
    available: null,
    status: null,
    creationDate: null,
    lastCheckDate: null
  };
  history: any = { stock: { id: '' }, user: { id: '' }, date: '', type: 'withdraw' };

  isStockSelected = false;
  isButtonEnabled = true;
  responsiveOptions: any[] | undefined;

  isWallMode = false;

  constructor(
    protected scanService: ScanService,
    private scanSocketService: ScanSocketService,
    private messageService: MessageService,
    protected stockService: StockService,
    private checkService: CheckService,
    private authApp: AuthAppService,
    private historyService: HistoryService,
    protected productService: ProductService
  ) {}

  async ngOnInit(): Promise<void> {
    this.responsiveOptions = [
      { breakpoint: '1400px', numVisible: 3, numScroll: 3 },
      { breakpoint: '1220px', numVisible: 2, numScroll: 2 },
      { breakpoint: '1100px', numVisible: 1, numScroll: 1 }
    ];
    await this.loadStocks();
    await this.loadLastCheckDates();
    await this.historyService.refreshHistory();
    this.loadBorrowers();
    this.buildLockersMapAndStats();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // Normalisation alitracer
  private normalizeAlitracer(value: string | null | undefined): string {
    return (value ?? '')
      .toString()
      .trim()
      .replace(/[\r\n\t ]+/g, '')
      .replace(/^N/, '')
      .toUpperCase();
  }

  private getStockAlitracers(stock: any): string[] {
    const raw: string = stock?.alitracer ?? '';
    return raw
      .split('|')
      .map((a: string) => this.normalizeAlitracer(a.trim()))
      .filter(Boolean);
  }

  private async loadStocks(): Promise<void> {
    await this.scanService.refreshAvailableStocks();
    await this.scanService.refreshLoanedStocks();
    this.availableStocks = this.scanService.getAvailableStocks();
    this.loanedStocks = this.scanService.getLoanedStocks();
    this.allStocks = [...this.availableStocks, ...this.loanedStocks].filter(
      s => s.emplacement !== 'Atelier'
    );
  }

  private async loadLastCheckDates(): Promise<void> {
    for (const stock of this.allStocks) {
      this.stockService.getCheckIdByStockId(stock.id).subscribe({
        next: (checks) => {
          if (checks.length > 0) {
            const latestCheck = checks.sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
            )[0];
            stock.lastCheckDate = new Date(latestCheck.date).toLocaleString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
          } else {
            stock.lastCheckDate = null;
          }
        },
        error: () => {
          stock.lastCheckDate = null;
        }
      });
    }
  }

  private loadBorrowers(): void {
    const allWithdrawHistory = this.historyService.getAllWithdrawHistory();
    for (const stock of this.allStocks) {
      if (!stock.available) {
        const stockHistories = allWithdrawHistory.filter(
          h => String(h.stock?.id) === String(stock.id)
        );
        const lastWithdraw = stockHistories.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0];
        stock.borrowedBy = lastWithdraw?.user ?? null;
      } else {
        stock.borrowedBy = null;
      }
    }
  }

  get wallStocks(): any[] {
    const wall = this.allStocks.filter((s: any) => s.emplacement === 'Mur');
    if (!this.activeFilterTitle) return wall;
    return wall.filter((s: any) => s.product?.title === this.activeFilterTitle);
  }

  get wallWithdrawMax(): number {
    return this.wallStocks.filter(
      (s: any) => s.available && s.status !== 2
    ).length;
  }

  openWallWithdrawDialog(): void {
    this.isWallMode = true;
    this.withdrawMax = this.wallWithdrawMax;
    this.withdrawQuantity = 1;
    this.withdrawDialogVisible = true;
  }

  private buildProductFilters(): void {
    const seen = new Set<string>();
    const filters: ProductFilter[] = [];

    for (const stock of this.allStocks) {
      const title = stock.product?.title;
      if (title && !seen.has(title)) {
        seen.add(title);
        filters.push({
          title,
          picture: stock.product?.picture || 'assets/images/default_image.jpg'
        });
      }
    }
    this.productFilters = filters;

    // Compte les emplacements (casiers + Mur) où chaque produit est présent,
    // pas seulement les casiers — sinon un produit uniquement stocké sur le
    // Mur affichait "0 casier(s)" alors qu'il est bien filtrable.
    const wallStocksAll = this.allStocks.filter((s: any) => s.emplacement === 'Mur');
    const counts: { [title: string]: number } = {};
    for (const title of seen) {
      const lockerCount = this.lockers.filter(num =>
        (this.lockerStocksCache.get(num) ?? []).some(s => s.product?.title === title)
      ).length;
      const onWall = wallStocksAll.some(s => s.product?.title === title);
      counts[title] = lockerCount + (onWall ? 1 : 0);
    }
    this.filterCounts = counts;
  }

  setFilter(title: string | null): void {
    this.activeFilterTitle = this.activeFilterTitle === title ? null : title;
    this.updateFilterMatches();
  }

  /**
   * Marque, pour chaque casier déjà présent dans lockersMap, s'il contient le
   * produit du filtre actif. Les casiers restent tous affichés — seuls ceux
   * qui correspondent au filtre reçoivent l'anneau jaune (scanCellTpl).
   */
  private updateFilterMatches(): void {
    for (const num of this.lockers) {
      const info = this.lockersMap[num];
      if (!info) continue;
      info.matchesFilter = !!this.activeFilterTitle &&
        (this.lockerStocksCache.get(num) ?? []).some(s => s.product?.title === this.activeFilterTitle);
    }
  }

  getLockerCountByTitle(title: string): number {
    return this.filterCounts[title] ?? 0;
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
    let available = 0, empty = 0;

    for (const num of this.lockers) {
      const stocks = this.lockerStocksCache.get(num) ?? [];
      const hasStock = stocks.length > 0;

      let state: LockerInfo['state'] = 'empty';
      let ratio = '0/0';
      let firstStock: LockerInfo['firstStock'] = null;

      if (hasStock) {
        const nonHs = stocks.filter(s => s.status !== 2);
        const availableNonHs = nonHs.filter(s => s.available === true).length;
        if (nonHs.length === 0 || availableNonHs === 0) state = 'allBorrowed';
        else if (availableNonHs === nonHs.length) state = 'allAvailable';
        else state = 'mixed';

        const availableTotal = stocks.filter(s => s.available === true && s.status !== 2).length;
        ratio = `${availableTotal}/${stocks.length}`;
        firstStock = {
          title: stocks[0].product.title,
          size: stocks[0].product.size,
          cmu: stocks[0].product.cmu
        };

        if (availableTotal > 0) available++;
      } else {
        empty++;
      }

      map[num] = { hasStock, state, ratio, firstStock, matchesFilter: false };
    }

    this.lockersMap = map;
    this.stats = { available, empty, total: this.lockers.length };

    this.buildProductFilters();
    this.updateFilterMatches();
  }

  async refreshLockers(): Promise<void> {
    await this.updateAvailableStocks();
    await this.loadLastCheckDates();
    await this.historyService.refreshHistory();
    this.loadBorrowers();
    this.buildLockersMapAndStats();
  }

  isLoggedIn() { return this.authApp.isLoggedIn(); }
  isAdmin() { return this.authApp.isAdmin(); }
  isMaintenance() { return this.authApp.isMaintenance(); }
  isOperator() { return this.authApp.isOperator(); }

  getStocksByLocker(lockerNumber: number): any[] {
    return this.lockerStocksCache.get(lockerNumber) ?? [];
  }

  getAlitracerList(stock: any): string[] {
    return StockService.getAlitracerList(stock);
  }

  openLockerDetails(lockerNumber: number): void {
    this.activeLocker = lockerNumber;
    this.lockerStocks = this.getStocksByLocker(lockerNumber);
    this.lockerDetailsDialogVisible = true;
  }

  getStatusClass(stock: any): string {
    if (stock.status === 1) return 'text-green-500 font-bold';
    if (stock.status === 0) return 'text-black font-bold';
    if (stock.status === 2) return 'text-red-600 font-bold';
    return 'text-gray-500';
  }

  canWithdraw(lockerNumber: number): boolean {
    return this.getStocksByLocker(lockerNumber).some(
      s => s.available === true && s.status !== 2
    );
  }

  openWithdrawDialog(lockerNumber: number): void {
    const stocks = this.getStocksByLocker(lockerNumber);
    this.withdrawStocksPool = stocks.filter(s => s.available === true && s.status !== 2);
    this.withdrawMax = this.withdrawStocksPool.length;

    if (this.withdrawMax === 0) {
      const hasAvailableHs = stocks.some(s => s.available === true && s.status === 2);
      this.messageService.add({
        severity: hasAvailableHs ? 'error' : 'info',
        summary: hasAvailableHs ? 'Produit HS' : 'Aucun outil à retirer',
        detail: hasAvailableHs
          ? `Impossible de retirer dans le casier ${lockerNumber} : les stocks disponibles sont HS.`
          : `Aucun outil disponible à retirer dans le casier ${lockerNumber}.`
      });
      return;
    }

    this.activeLocker = lockerNumber;
    this.withdrawQuantity = 1;
    this.withdrawDialogVisible = true;
  }

  async confirmWithdrawQuantity(): Promise<void> {
    if (this.withdrawQuantity < 1 || this.withdrawQuantity > this.withdrawMax) {
      this.messageService.add({
        severity: 'error',
        summary: 'Quantité invalide',
        detail: `Saisissez un nombre entre 1 et ${this.withdrawMax}.`
      });
      return;
    }

    this.withdrawDialogVisible = false;
    this.lockerDetailsDialogVisible = false;

    if (this.isWallMode) {
      this.withdrawStocksPool = this.wallStocks.filter(
        s => s.available && s.status !== 2
      );
      this.expectedAlitracers = this.withdrawStocksPool.flatMap(
        (s: any) => this.getStockAlitracers(s)
      );
      this.lockedFlow = 'withdraw';
      this.safetyDialogVisible = true;
      return;
    }

    if (!this.activeLocker) return;

    try {
      await this.scanService.openLocker(this.activeLocker);
      this.messageService.add({
        severity: 'info',
        summary: 'Casier ouvert',
        detail: `Casier ${this.activeLocker} ouvert, prenez les ${this.withdrawQuantity} stock(s).`
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur casier',
        detail: `Impossible d'ouvrir le casier ${this.activeLocker}.`
      });
      return;
    }

    this.expectedAlitracers = this.withdrawStocksPool.flatMap(
      (s: any) => this.getStockAlitracers(s)
    );
    this.lockedFlow = 'withdraw';
    this.lockerCloseDialogVisible = true;
  }

  async confirmLockerClosed(): Promise<void> {
    this.lockerCloseDialogVisible = false;
    if (!this.activeLocker) return;

    try {
      await this.scanService.closeLocker(this.activeLocker);
      this.messageService.add({
        severity: 'info',
        summary: 'Casier fermé',
        detail: `Casier ${this.activeLocker} fermé.`
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur casier',
        detail: `Impossible de fermer le casier ${this.activeLocker}.`
      });
    }

    if (this.lockedFlow === 'withdraw') {
      this.safetyDialogVisible = true;
    }
    if (this.lockedFlow === 'deposit') this.lockedFlow = null;
  }

  confirmSafety(): void {
    this.safetyDialogVisible = false;
    this.scanMode = 'withdraw';
    this.targetScanCount = this.withdrawQuantity;
    this.scannedCount = 0;
    this.scanDialogVisible = true;
    setTimeout(() => this.startPolling(), 0);
  }

  private startPolling(): void {
    this.scanSubscription = this.scanSocketService.scan$.subscribe(async response => {
      if (this.isProcessing) return;
      try {
        if (response?.success && response?.value) {
          const raw: string = response.value;

          if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return;
          }

          if (raw.length > 20) {
            return;
          }

          const val = this.normalizeAlitracer(raw);
          if (val !== '') {
            this.isProcessing = true;
            await this.handleScannedCode(val);
          }
        }
      } catch {}
    });
  }

  submitManualScan(): void {
    const suffix = this.manualSuffix.trim();
    if (!/^\d{4}$/.test(suffix)) {
      this.manualScanError = 'Saisissez exactement 4 chiffres.';
      return;
    }
    this.manualScanError = '';

    const normalized4 = suffix.padStart(4, '0');
    const matchingStock = this.allStocks.find(s =>
      this.getStockAlitracers(s).some(a => a.endsWith(normalized4))
    );

    let alitracer: string;
    if (matchingStock) {
      alitracer = this.getStockAlitracers(matchingStock).find(a => a.endsWith(normalized4))!;
    } else {
      alitracer = this.normalizeAlitracer('L' + suffix.padStart(10, '0'));
    }

    this.manualSuffix = '';
    this.isProcessing = true;
    this.handleScannedCode(alitracer);
  }

  private stopPolling(): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
    this.isProcessing = false;
  }

  private async handleScannedCode(decodedText: string): Promise<void> {
    const alitracer = this.normalizeAlitracer(decodedText);

    if (this.expectedAlitracers.length > 0) {
      const normalizedExpected = this.expectedAlitracers.map(
        x => this.normalizeAlitracer(x)
      );
      if (!normalizedExpected.includes(alitracer)) {
        this.messageService.add({
          severity: 'error',
          summary: 'Alitracer non attendu',
          detail: `Le code scanné (${alitracer}) ne fait pas partie des outils attendus pour le casier ${this.activeLocker}.`
        });
        await this.scanService.clearScan();
        this.isProcessing = false;
        return;
      }
    }

    const stock = this.allStocks.find(s =>
      this.getStockAlitracers(s).some(a => this.normalizeAlitracer(a) === alitracer)
    );

    if (!stock) {
      this.messageService.add({
        severity: 'error',
        summary: 'Stock introuvable',
        detail: `Aucun stock trouvé pour l'ID Alitracer scanné : ${alitracer}.`
      });
      await this.scanService.clearScan();
      this.isProcessing = false;
      return;
    }

    if (stock.status === 2) {
      this.messageService.add({
        severity: 'error',
        summary: 'Produit HS',
        detail: 'Ce stock est HS, il ne peut pas être retiré ou déposé.'
      });
      await this.scanService.clearScan();
      this.isProcessing = false;
      return;
    }

    if (this.scanMode === 'withdraw') {
      if (!stock.available) {
        this.messageService.add({
          severity: 'error',
          summary: 'Stock déjà emprunté',
          detail: 'Ce stock est déjà emprunté.'
        });
        this.isProcessing = false;
        return;
      }
      await this.processWithdrawScan(stock);
    }

    if (this.scanMode === 'deposit') {
      if (stock.available) {
        this.messageService.add({
          severity: 'warn',
          summary: 'Déjà en stock',
          detail: 'Ce stock est déjà disponible.'
        });
        this.isProcessing = false;
        return;
      }
      await this.processDepositScan(stock);
    }

    this.scannedCount++;
    await this.scanService.clearScan();
    this.isProcessing = false;

    if (this.scannedCount >= this.targetScanCount) {
      this.stopPolling();
      this.scanDialogVisible = false;
      this.isWallMode = false;

      if (this.scanMode === 'deposit' && this.activeLocker) {
        try {
          await this.scanService.openLocker(this.activeLocker);
          this.lockedFlow = 'deposit';
          this.lockerCloseDialogVisible = true;
        } catch {
          this.messageService.add({
            severity: 'error',
            summary: 'Erreur casier',
            detail: `Impossible d'ouvrir le casier ${this.activeLocker} pour dépôt.`
          });
        }
      }

      this.scanMode = null;
      await this.updateAvailableStocks();
      await this.loadLastCheckDates();
      await this.historyService.refreshHistory();
      this.loadBorrowers();
      this.buildLockersMapAndStats();
    }
  }

  private async processWithdrawScan(stock: any): Promise<void> {
    // 1) mettre à jour l’état métier
    stock.available = false;
    // si tu veux aussi sortir physiquement du casier :
    stock.lockerNumber = null;
    stock.emplacement = null;

    // 2) persister côté backend
    this.stockService.updateStock(stock);

    // 3) MAJ cache local
    const inAll = this.allStocks.find(s => s.id === stock.id);
    if (inAll) {
      inAll.available = stock.available;
      inAll.lockerNumber = stock.lockerNumber;
      inAll.emplacement = stock.emplacement;
    }

    // 4) historique + UI
    this.history.type = 'withdraw';
    this.stock.id = stock.id;
    this.review = stock;
    this.isStockSelected = true;
    this.getLatestDate();
    await this.addScan('withdraw');
  }

  private async processDepositScan(stock: any): Promise<void> {
    // Ici, on considère que le dépôt remet l’outil dispo dans le casier actif
    stock.available = true;
    if (this.activeLocker) {
      stock.lockerNumber = this.activeLocker;
      stock.emplacement = 'Casier';
    }

    this.stockService.updateStock(stock);

    const inAll = this.allStocks.find(s => s.id === stock.id);
    if (inAll) {
      inAll.available = stock.available;
      inAll.lockerNumber = stock.lockerNumber;
      inAll.emplacement = stock.emplacement;
    }

    this.history.type = 'deposit';
    this.stock.id = stock.id;
    this.review = stock;
    this.isStockSelected = true;
    this.getLatestDate();
    await this.addScan('deposit');
  }

  async addScan(type: string): Promise<void> {
    const appUser = this.authApp.getCurrentUser();
    if (!appUser) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Vous devez être connecté.'
      });
      return;
    }

    this.isButtonEnabled = false;
    this.history.date = new Date().toISOString();
    this.history.user.id = appUser.id;
    this.history.stock.id = this.stock.id;
    this.history.type = type;

    try {
      await this.scanService.createHistory(this.history);
      this.showAddToast(type);
      await this.scanService.refreshData();
      await this.updateAvailableStocks();
      await this.loadLastCheckDates();
      await this.historyService.refreshHistory();
      this.loadBorrowers();
      this.buildLockersMapAndStats();
    } catch (error) {
      console.error('Erreur addScan:', error);
      this.showAddErrorToast(type);
    }

    this.stock.id = '';
    this.history.stock.id = '';
    this.isStockSelected = false;
    this.isButtonEnabled = true;
  }

  async updateAvailableStocks(): Promise<void> {
    await this.loadStocks();
  }

  getLatestDate(): void {
    this.stockService.getCheckIdByStockId(this.stock.id).subscribe({
      next: checks => {
        if (checks.length > 0) {
          const latestCheck = checks.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0];
          this.review.lastCheckDate = new Date(latestCheck.date).toLocaleString();
        } else {
          this.review.lastCheckDate = 'Aucune donnée disponible';
        }
      },
      error: () => {}
    });
  }

  showAddToast(type: string): void {
    const label = type === 'withdraw' ? 'Retrait' : 'Dépôt';
    const toolName = this.review?.product?.title || this.review?.alitracer;
    this.messageService.add({
      severity: 'success',
      summary: `${label} enregistré`,
      detail: toolName
        ? `${label} de "${toolName}" enregistré avec succès.`
        : `${label} enregistré avec succès.`
    });
  }

  showAddErrorToast(type: string): void {
    const label = type === 'withdraw' ? 'retrait' : 'dépôt';
    const toolName = this.review?.product?.title || this.review?.alitracer;
    this.messageService.add({
      severity: 'error',
      summary: 'Erreur',
      detail: toolName
        ? `Impossible d'enregistrer le ${label} de "${toolName}".`
        : `Impossible d'enregistrer le ${label}.`
    });
  }

  protected readonly faBarcode = faBarcode;
}
