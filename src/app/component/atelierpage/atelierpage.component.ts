import { Component, OnInit, OnDestroy } from '@angular/core';
import { NgForOf, NgIf, NgClass, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { faWrench, faCamera, faStop, faShieldAlt, faUser } from '@fortawesome/free-solid-svg-icons';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

import { StockService } from '../../services/stock.service';
import { AuthAppService } from '../../services/auth-app.service';
import { CheckService } from '../../services/check.service';
import { PdfService, CheckPdfData } from '../../services/pdf.service';
import { ExcelService } from '../../services/excel.service';

import { ZoneService, Zone } from '../../services/zone.service';

import jsQR from 'jsqr';

@Component({
  selector: 'app-atelierpage',
  standalone: true,
  templateUrl: './atelierpage.component.html',
  styleUrls: ['./atelierpage.component.css'],
  imports: [
    NgForOf,
    NgIf,
    NgClass,
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    DialogModule,
    ToastModule,
    FaIconComponent,
    JsonPipe
  ],
  providers: [MessageService]
})
export class AtelierpageComponent implements OnInit, OnDestroy {

  // --------- STOCKS ---------

  allStocks: any[] = [];

  get atelierStocks(): any[] {
    return this.allStocks.filter(s => s.emplacement === 'Atelier');
  }

  /** Stocks de la zone sélectionnée (ou tous si aucune zone) */
  get filteredAtelierStocks(): any[] {
    if (!this.selectedZone) {
      return this.atelierStocks;
    }
    const zoneId = this.selectedZone.id;
    return this.atelierStocks.filter(s => s.zone && s.zone.id === zoneId);
  }

  /** KPI : contrôlés réglementairement ce mois dans la zone sélectionnée */
  checkedThisMonthCount = 0;

  /** KPI : contrôles à faire dans la zone sélectionnée */
  needsCheckCount = 0;

  // --------- CAMÉRA / SCAN ---------

  scanDialogVisible = false;
  scanMode: 'INDIVIDUAL' | 'REGULATORY' = 'INDIVIDUAL';
  isProcessing = false;
  private lastScannedCode: string | null = null;

  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;

  // --------- CHECK POPUP ---------

  checkDialogVisible = false;
  selectedStockForCheck: any = null;
  checkComment = '';

  // --------- DÉTAIL STOCK ---------

  stockDetailDialogVisible = false;
  selectedStock: any = null;

  // --------- ZONES ---------

  zones: Zone[] = [];
  zonesWithCoords: { zone: Zone; x: number; y: number; w: number; h: number }[] = [];

  selectedZone: Zone | null = null;

  zoneDialogVisible = false;
  zoneEditMode: 'CREATE' | 'EDIT' = 'CREATE';

  zoneForm: Zone = {
    id: undefined,
    name: '',
    x: 50,
    y: 50,
    w: 20,
    h: 20
  };

  private dragStartX: number | null = null;
  private dragStartY: number | null = null;
  isDrawing = false;

  selectionPreview = { x: 0, y: 0, w: 0, h: 0 };

  // --------- ICONES ---------

  protected readonly faWrench = faWrench;
  protected readonly faCamera = faCamera;
  protected readonly faStop = faStop;
  protected readonly faShieldAlt = faShieldAlt;
  protected readonly faUser = faUser;

  constructor(
    private authApp: AuthAppService,
    private checkService: CheckService,
    private pdfService: PdfService,
    private excelService: ExcelService,
    private httpClient: HttpClient,
    private messageService: MessageService,
    private zoneService: ZoneService,
    private stockService: StockService
  ) {}

  // --------- LIFECYCLE ---------

  async ngOnInit(): Promise<void> {
    await this.loadStocks();
    await this.loadLastCheckDates();
    await this.loadZones();
    this.refreshStats();
  }

  ngOnDestroy(): void {
    this.stopCameraInternal();
  }

  // --------- AUTH ---------

  isLoggedIn() { return this.authApp.isLoggedIn(); }
  isAdmin()    { return this.authApp.isAdmin(); }
  isMaintenance() { return this.authApp.isMaintenance(); }

  // --------- STOCKS / DATES ---------

  private async loadStocks(): Promise<void> {
    await this.stockService.refreshStocks();
    this.allStocks = this.stockService.getAllStocks();
  }

  private async loadLastCheckDates(): Promise<void> {
    const atelierStocks = this.atelierStocks;

    await Promise.all(
      atelierStocks.map(async stock => {
        try {
          const checks: any[] = await this.checkService.getCheckByStockId(stock.id) as any;
          if (!checks || checks.length === 0) {
            stock.lastCheckDate = null;
            stock.lastRegulatoryCheckDate = null;
            return;
          }

          const sorted = [...checks].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          );

          stock.lastCheckDate = this.formatDate(new Date(sorted[0].date));

          const regulatory = checks.filter(c => this.isRegulatoryCheck(c));
          if (regulatory.length > 0) {
            const latestReg = [...regulatory].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
            )[0];
            stock.lastRegulatoryCheckDate = this.formatDate(new Date(latestReg.date));
          } else {
            stock.lastRegulatoryCheckDate = null;
          }
        } catch {
          stock.lastCheckDate = null;
          stock.lastRegulatoryCheckDate = null;
        }
      })
    );

    this.refreshStats();
  }

  async refreshStocks(): Promise<void> {
    await this.loadStocks();
    await this.loadLastCheckDates();
    this.refreshStats();
  }

  private isRegulatoryCheck(c: any): boolean {
    const ct: string | null = c.checkType ?? c.type ?? null;
    return ct !== 'INDIVIDUAL';
  }

  /** ATTENTION : ici tu formates en jj/mm/aaaa hh:mm, donc on parse en conséquence */
  private isDateThisMonth(dateStr: string | null): boolean {
    if (!dateStr) return false;
    // format attendu après formatDate : "jj/mm/aaaa hh:mm"
    const parts = dateStr.split(/[\\s/:-]/);
    if (parts.length < 3) return false;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);

    const d = new Date(year, month, day);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  isStockCheckedRegulatoryThisMonth(stock: any): boolean {
    return this.isDateThisMonth(stock.lastRegulatoryCheckDate);
  }

  /** KPI global atelier (toutes zones confondues) */
  getLockerCheckRatioAtelier(): string {
    const stocks = this.filteredAtelierStocks;
    const total = stocks.length;
    if (total === 0) return '0 / 0';
    const done = stocks.filter(s => this.isStockCheckedRegulatoryThisMonth(s)).length;
    return `${done} / ${total}`;
  }

  /** Recalcule checkedThisMonthCount et needsCheckCount pour la zone sélectionnée */
  private refreshStats(): void {
    const stocks = this.filteredAtelierStocks;
    const done = stocks.filter(s => this.isStockCheckedRegulatoryThisMonth(s)).length;
    console.log('refreshStats zone', this.selectedZone?.name, 'done=', done, 'total=', stocks.length);
    this.checkedThisMonthCount = done;
    this.needsCheckCount = stocks.length - done;
  }

  // --------- SCAN PLEIN ÉCRAN ---------

  startScan(mode: 'INDIVIDUAL' | 'REGULATORY'): void {
    this.scanMode = mode;
    this.lastScannedCode = null;
    this.isProcessing = false;
    this.scanDialogVisible = true;
    setTimeout(() => this.startCamera(), 150);
  }

  private async startCamera(): Promise<void> {
    this.videoEl = document.getElementById('atelier-video') as HTMLVideoElement;
    this.canvasEl = document.getElementById('atelier-canvas') as HTMLCanvasElement;

    if (!this.videoEl || !this.canvasEl) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur DOM',
        detail: 'Impossible de trouver les éléments vidéo/canvas.'
      });
      this.scanDialogVisible = false;
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.scanFrame();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Caméra inaccessible',
        detail: 'Autorisez l\'accès à la caméra dans votre navigateur.'
      });
      this.scanDialogVisible = false;
    }
  }

  private scanFrame(): void {
    if (!this.scanDialogVisible || !this.videoEl || !this.canvasEl) {
      return;
    }

    const video = this.videoEl;
    const canvas = this.canvasEl;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
      this.rafId = requestAnimationFrame(() => this.scanFrame());
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });

    if (code?.data) {
      if (code.data !== this.lastScannedCode && !this.isProcessing) {
        this.lastScannedCode = code.data;
        this.isProcessing = true;
        this.handleScannedCode(code.data).finally(() => {
          setTimeout(() => {
            this.lastScannedCode = null;
            this.isProcessing = false;
          }, 1500);
        });
      }
    }

    this.rafId = requestAnimationFrame(() => this.scanFrame());
  }

  private stopCameraInternal(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    this.isProcessing = false;
    this.lastScannedCode = null;
    this.videoEl = null;
    this.canvasEl = null;
  }

  stopScan(): void {
    this.scanDialogVisible = false;
    this.stopCameraInternal();
    this.checkDialogVisible = false;
    this.selectedStockForCheck = null;
    this.checkComment = '';
  }

  // --------- SCAN -> POPUP CHECK ---------

  private async handleScannedCode(code: string): Promise<void> {
    const alitracer = code.trim();

    const stock = StockService.findByAlitracer(this.filteredAtelierStocks, alitracer);

    if (!stock) {
      this.messageService.add({
        severity: 'error',
        summary: 'Stock introuvable',
        detail: `Aucun stock dans la zone sélectionnée pour l'alitracer ${alitracer}`
      });
      return;
    }

    // Empêcher les scans réglementaires multiples dans le même mois
    if (this.scanMode === 'REGULATORY' && this.isStockCheckedRegulatoryThisMonth(stock)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Déjà contrôlé',
        detail: `${stock.alitracer} a déjà un contrôle réglementaire ce mois-ci.`
      });
      return;
    }

    if (stock.status === 2) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Stock HS',
        detail: `${stock.alitracer} est déjà marqué HS.`
      });
      return;
    }

    // pause caméra pendant le choix OK/NOK/HS
    this.stopCameraInternal();
    this.selectedStockForCheck = stock;
    this.checkComment = '';
    this.checkDialogVisible = true;
  }

  confirmCheck(status: number): void {
    this.checkDialogVisible = false;
    this.executeCheck(status);
  }

  cancelCheck(): void {
    this.checkDialogVisible = false;
    this.selectedStockForCheck = null;
    this.checkComment = '';
    if (this.scanDialogVisible) {
      setTimeout(() => this.startCamera(), 150);
    }
  }

  private async executeCheck(status: number): Promise<void> {
    if (!this.selectedStockForCheck) return;

    const appUser = this.authApp.getCurrentUser();
    if (!appUser) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Vous devez être connecté.'
      });
      if (this.scanDialogVisible) {
        setTimeout(() => this.startCamera(), 150);
      }
      return;
    }

    const checkType = this.scanMode;
    const checkDate = new Date().toISOString();

    const payload = {
      id: null,
      date: checkDate,
      status,
      comment: this.checkComment,
      checkType,
      user: { id: appUser.id },
      stock: { id: this.selectedStockForCheck.id }
    };

    try {
      const savedCheck: any = await this.checkService.createCheck(payload);

      const pdfData: CheckPdfData = {
        checkDate: checkDate,
        productName: this.selectedStockForCheck.product?.title || 'Produit inconnu',
        alitracer: this.selectedStockForCheck.alitracer,
        reference: this.selectedStockForCheck.reference,
        lockerNumber: this.selectedStockForCheck.lockerNumber ?? 0,
        status,
        comment: this.checkComment,
        controlledBy: appUser.username,
        brand: this.selectedStockForCheck.product?.brand || 'N/A',
        cmu: this.selectedStockForCheck.product?.cmu || 'N/A',
        size: this.selectedStockForCheck.product?.size || 'N/A'
      };

      const pdfResult: any = await this.pdfService.generateAndSavePdf(pdfData);
      if (pdfResult?.filename) {
        await this.httpClient
          .patch(
            `api/checks/${savedCheck.id}/pdf`,
            {},
            { params: { filename: pdfResult.filename } }
          )
          .toPromise();
      }

      if (checkType === 'REGULATORY') {
        await this.updateMonthlyExcel(
          this.selectedStockForCheck,
          status,
          this.checkComment,
          appUser.username
        );
      }

      if (status === 2) {
        try {
          await this.httpClient
            .patch(`api/stocks/${this.selectedStockForCheck.id}/withdraw`, {})
            .toPromise();
        } catch {}
      }

      // Mise à jour locale pour affichage immédiat
      const formatted = this.formatDate(new Date());
      const inList = this.allStocks.find(s => s.id === this.selectedStockForCheck!.id);
      if (inList) {
        inList.status = status;
        inList.lastCheckDate = formatted;
        if (checkType === 'REGULATORY') {
          inList.lastRegulatoryCheckDate = formatted;
        }
        if (status === 2) {
          inList.lockerNumber = 0;
        }
      }

      // On recharge pour resynchroniser avec le backend si réglementaire
      if (checkType === 'REGULATORY') {
        await this.refreshStocks();
      } else {
        // contrôle individuel : au moins rafraîchir les stats locales
        this.refreshStats();
      }

      this.messageService.add({
        severity: 'success',
        summary: 'Contrôle enregistré',
        detail:
          checkType === 'REGULATORY'
            ? 'Contrôle réglementaire enregistré, Excel mis à jour.'
            : 'Contrôle individuel enregistré.'
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Impossible d\'enregistrer le contrôle.'
      });
    }

    this.selectedStockForCheck = null;
    this.checkComment = '';

    if (this.scanDialogVisible) {
      setTimeout(() => this.startCamera(), 150);
    }
  }

  private async updateMonthlyExcel(
    stock: any,
    status: number,
    comment: string,
    username: string
  ): Promise<void> {
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
  private formatStockLocation(stock: any): string {
    if (stock.lockerNumber) return `Casier ${stock.lockerNumber}`;
    return stock.zone?.name || stock.emplacement || 'N/A';
  }

  // --------- HELPERS AFFICHAGE ---------

  getAlitracerList(stock: any): string[] {
    return StockService.getAlitracerList(stock);
  }

  getStatusClass(stock: any): string {
    if (stock.status === 1) return 'text-green-500 font-bold';
    if (stock.status === 0) return 'text-orange-500 font-bold';
    if (stock.status === 2) return 'text-red-600 font-bold';
    return 'text-gray-500';
  }

  getStatusLabel(stock: any): string {
    if (stock.status === 1) return 'OK';
    if (stock.status === 0) return 'NOK';
    if (stock.status === 2) return 'HS';
    return 'Inconnu';
  }

  needsCheck(stock: any): boolean {
    return !this.isStockCheckedRegulatoryThisMonth(stock);
  }

  openStockDetail(stock: any): void {
    this.selectedStock = stock;
    this.stockDetailDialogVisible = true;
  }

  private formatDate(date: Date): string {
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // --------- ZONES ---------

  private async loadZones(): Promise<void> {
    await this.zoneService.refreshZones();
    this.zones = this.zoneService.getAllZones();
    this.zonesWithCoords = this.zones.map(z => ({
      zone: z,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h
    }));
  }

  selectZone(zone: Zone | null): void {
    this.selectedZone = zone;
    this.refreshStats();
  }

  openCreateZoneDialog(): void {
    this.zoneEditMode = 'CREATE';
    this.zoneForm = {
      id: undefined,
      name: '',
      x: 50,
      y: 50,
      w: 20,
      h: 20
    };
    this.dragStartX = null;
    this.dragStartY = null;
    this.isDrawing = false;
    this.selectionPreview = { x: 0, y: 0, w: 0, h: 0 };
    this.zoneDialogVisible = true;
  }

  openEditZoneDialog(zone: Zone): void {
    this.zoneEditMode = 'EDIT';
    this.zoneForm = { ...zone };
    this.selectionPreview = {
      x: this.zoneForm.x - this.zoneForm.w / 2,
      y: this.zoneForm.y - this.zoneForm.h / 2,
      w: this.zoneForm.w,
      h: this.zoneForm.h
    };
    this.dragStartX = null;
    this.dragStartY = null;
    this.isDrawing = false;
    this.zoneDialogVisible = true;
  }

  async saveZone(): Promise<void> {
    const f = this.zoneForm;

    if (!f.name || f.w <= 0 || f.h <= 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Zone incomplète',
        detail: 'Nom, largeur et hauteur doivent être renseignés.'
      });
      return;
    }

    try {
      if (this.zoneEditMode === 'CREATE') {
        await this.zoneService.createZone(f);
      } else {
        await this.zoneService.updateZone(f);
      }
      await this.loadZones();
      this.zoneDialogVisible = false;
      this.messageService.add({
        severity: 'success',
        summary: 'Zone enregistrée',
        detail: `Zone "${f.name}" sauvegardée.`
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur zone',
        detail: 'Impossible d\'enregistrer la zone.'
      });
    }
  }

  async deleteZone(): Promise<void> {
    if (!this.zoneForm.id) return;

    try {
      await this.zoneService.deleteZone(this.zoneForm.id);
      await this.loadZones();
      this.zoneDialogVisible = false;
      if (this.selectedZone?.id === this.zoneForm.id) {
        this.selectedZone = null;
        this.refreshStats();
      }
      this.messageService.add({
        severity: 'success',
        summary: 'Zone supprimée',
        detail: 'La zone a bien été supprimée.'
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur suppression',
        detail: 'Impossible de supprimer la zone.'
      });
    }
  }

  // --------- DRAG-TO-DRAW SUR LA CARTE ---------

  onMapMouseDown(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    this.dragStartX = ((event.clientX - rect.left) / rect.width) * 100;
    this.dragStartY = ((event.clientY - rect.top) / rect.height) * 100;

    this.isDrawing = true;
    this.selectionPreview = { x: this.dragStartX, y: this.dragStartY, w: 0, h: 0 };

    event.preventDefault();
  }

  onMapMouseMove(event: MouseEvent): void {
    if (!this.isDrawing || this.dragStartX === null || this.dragStartY === null) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    const xNow = ((event.clientX - rect.left) / rect.width) * 100;
    const yNow = ((event.clientY - rect.top) / rect.height) * 100;

    const x = Math.min(this.dragStartX, xNow);
    const y = Math.min(this.dragStartY, yNow);
    const w = Math.abs(xNow - this.dragStartX);
    const h = Math.abs(yNow - this.dragStartY);

    this.selectionPreview = { x, y, w, h };

    this.zoneForm.x = x + w / 2;
    this.zoneForm.y = y + h / 2;
    this.zoneForm.w = w;
    this.zoneForm.h = h;
  }

  onMapMouseUp(_event: MouseEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
  }
}
