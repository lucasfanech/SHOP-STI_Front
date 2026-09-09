import { Component, OnInit } from '@angular/core';
import { NgForOf, NgIf, NgClass } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { CarouselModule } from 'primeng/carousel';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { faBoxesStacked } from '@fortawesome/free-solid-svg-icons';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';

import { QRCodeModule } from 'angularx-qrcode';

import { StockService } from '../../services/stock.service';
import { ProductService } from '../../services/product.service';
import { CheckService } from '../../services/check.service';
import { HistoryService } from '../../services/history.service';
import { AuthAppService } from '../../services/auth-app.service';
import { ZoneService, Zone } from '../../services/zone.service';

type Emplacement = 'Casier' | 'Mur' | 'Atelier' | '';

@Component({
  selector: 'app-stockpage',
  standalone: true,
  imports: [
    NgForOf, NgIf, NgClass,
    ReactiveFormsModule, FormsModule,
    CarouselModule, TagModule, ButtonModule, DialogModule, ToastModule,
    FaIconComponent, QRCodeModule,
  ],
  templateUrl: './stockpage.component.html',
  providers: [MessageService],
  styleUrl: './stockpage.component.css'
})
export class StockpageComponent implements OnInit {

  // ------- Modèle "filtre produit" pour le sélecteur du haut ---------

  stock: any = {
    product: { id: null, title: '', size: '', cmu: '', picture: '' },
    available: null,
    status: null,
    creationDate: null,
  };

  // ------- Stock sélectionné pour édition / suppression --------------

  selectedStock: any = {
    product: null,
    available: null,
    status: null,
    creationDate: null,
    emplacement: '' as Emplacement,
    lockerNumber: null,
    zone: null
  };

  // ------- Création de stock -----------------------------------------

  dialogCreateVisible = false;
  selectedProductForCreate: any = null;

  newLockerNumber: number | null = null;
  newEmplacement: Emplacement = '';
  reference = '';

  alitracerInputs: string[] = [''];

  // Zone choisie en création (Atelier uniquement)
  zones: Zone[] = [];
  selectedZoneIdForCreate: number | null = null;

  // ------- Modification de stock -------------------------------------

  dialog1Visible = false;
  dialog2Visible = false;

  editAlitracerInputs: string[] = [''];

  countCheck   = 0;
  countHistory = 0;

  // Zone choisie en édition (Atelier uniquement)
  selectedZoneIdForEdit: number | null = null;

  // ------- Divers ----------------------------------------------------

  responsiveOptions: any[] | undefined;
  listOfProducts: any[] = [];

  protected readonly faBoxesStacked = faBoxesStacked;

  constructor(
    protected stockService: StockService,
    private messageService: MessageService,
    protected productService: ProductService,
    protected checkService: CheckService,
    protected historyService: HistoryService,
    private authApp: AuthAppService,
    private zoneService: ZoneService
  ) {}

  async ngOnInit() {
    this.responsiveOptions = [
      { breakpoint: '1400px', numVisible: 3, numScroll: 3 },
      { breakpoint: '1220px', numVisible: 2, numScroll: 2 },
      { breakpoint: '1100px', numVisible: 1, numScroll: 1 },
    ];

    this.listOfProducts = this.productService.getAllProducts();
    await this.stockService.refreshStocks();

    // Charger les zones atelier
    await this.zoneService.refreshZones();
    this.zones = this.zoneService.getAllZones();
  }

  // ------- Auth ------------------------------------------------------

  isLoggedIn()    { return this.authApp.isLoggedIn(); }
  isAdmin()       { return this.authApp.isAdmin(); }
  isMaintenance() { return this.authApp.isMaintenance(); }
  isOperator()    { return this.authApp.isOperator(); }

  // ------- Helpers alitracers ----------------------------------------

  getAlitracerList(stock: any): string[] {
    if (!stock?.alitracer) return [];
    return stock.alitracer
      .split('|')
      .map((a: string) => a.trim())
      .filter((a: string) => a !== '');
  }

  private joinAlitracers(inputs: string[]): string {
    return inputs
      .map(a => a.trim())
      .filter(a => a !== '')
      .join('|');
  }

  trackByIndex(index: number): number {
    return index;
  }

  // ------- Dialog CRÉATION ------------------------------------------

  openCreateDialog() {
    if (!this.stock.product?.id) return;

    this.selectedProductForCreate = this.productService.getAllProducts()
      .find((p: any) => p.id == this.stock.product.id);

    this.newLockerNumber          = null;
    this.newEmplacement           = '';
    this.reference                = '';
    this.alitracerInputs          = [''];
    this.selectedZoneIdForCreate  = null;

    this.dialogCreateVisible = true;
  }

  addAlitracerField() {
    this.alitracerInputs.push('');
  }

  removeAlitracerField(index: number) {
    if (this.alitracerInputs.length > 1) {
      this.alitracerInputs.splice(index, 1);
    }
  }

  createStock() {
    // Vérif emplacement
    if (!this.newEmplacement) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Veuillez sélectionner un emplacement.'
      });
      return;
    }

    // Vérif casier
    if (this.newEmplacement === 'Casier') {
      if (!this.newLockerNumber || this.newLockerNumber < 1 || this.newLockerNumber > 24) {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Le numéro de casier doit être compris entre 1 et 24.'
        });
        return;
      }
    }

    // Vérif alitracer(s)
    const alitracer = this.joinAlitracers(this.alitracerInputs);
    if (!alitracer) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Veuillez saisir au moins un alitracer.'
      });
      return;
    }

    const stockToSend: any = {
      product:      this.selectedProductForCreate,
      alitracer,
      reference:    this.reference,
      available:    true,
      status:       1,
      creationDate: new Date(),
      emplacement:  this.newEmplacement,
      lockerNumber: this.newEmplacement === 'Casier' ? this.newLockerNumber : null
    };

    // Lien avec zone si emplacement = Atelier
    if (this.newEmplacement === 'Atelier' && this.selectedZoneIdForCreate) {
      stockToSend.zone = { id: this.selectedZoneIdForCreate };
    } else {
      stockToSend.zone = null;
    }

    console.log('CREATE payload :', JSON.stringify(stockToSend));

    this.stockService.addStock(stockToSend);
    this.dialogCreateVisible = false;
    this.showAddToast();

    // reset du sélecteur produit
    this.stock.product.id = null;
  }

  // ------- Dialog MODIFICATION --------------------------------------

  showDialog(stock: any, dialogNumber: number) {
    if (dialogNumber === 1) {
      this.dialog1Visible = true;

      this.editAlitracerInputs = this.getAlitracerList(stock);
      if (this.editAlitracerInputs.length === 0) {
        this.editAlitracerInputs = [''];
      }
    } else {
      this.dialog2Visible = true;
    }

    // Cloner le stock sélectionné
    this.selectedStock = { ...stock };

    // S'assurer que emplacement est initialisé
    if (!this.selectedStock.emplacement) {
      this.selectedStock.emplacement = '';
    }

    // Init de la zone en édition
    this.selectedZoneIdForEdit = this.selectedStock.zone?.id ?? null;
  }

  addEditAlitracerField() {
    this.editAlitracerInputs.push('');
  }

  removeEditAlitracerField(index: number) {
    if (this.editAlitracerInputs.length > 1) {
      this.editAlitracerInputs.splice(index, 1);
    }
  }

  saveEditStock() {
    // Recalcule la chaîne alitracer à partir des inputs
    const alitracer = this.joinAlitracers(this.editAlitracerInputs);

    // On n’empêche pas la maj de tout si alitracer est vide :
    // on envoie juste null au back, qui décidera quoi faire.
    this.selectedStock.alitracer = alitracer || null;

    // Si l'emplacement n'est plus Casier, lockerNumber = null
    if (this.selectedStock.emplacement !== 'Casier') {
      this.selectedStock.lockerNumber = null;
    }

    // Gestion de la zone : on envoie TOUJOURS la clé "zone"
    if (this.selectedStock.emplacement === 'Atelier' && this.selectedZoneIdForEdit) {
      this.selectedStock.zone = { id: this.selectedZoneIdForEdit };
    } else {
      // dans tous les autres cas, on enlève la zone côté back
      this.selectedStock.zone = null;
    }

    console.log('payload envoyé au back : ', this.selectedStock);

    console.log('UPDATE payload :', JSON.stringify(this.selectedStock));

    this.stockService.updateStock(this.selectedStock);
    this.hideDialog();
    this.showUpdateToast();
  }

  hideDialog() {
    this.dialog1Visible = false;
    this.dialog2Visible = false;
  }

  // ------- Suppression ----------------------------------------------

  triggerDeleteStock() {
    this.checkService.getCheckByStockId(this.selectedStock.id).then((response: any) => {
      this.countCheck = response;
    });
    this.historyService.getHistoryByStockId(this.selectedStock.id).then((response: any) => {
      this.countHistory = response;
    });
  }

  // ------- Toasts ---------------------------------------------------

  showAddToast() {
    this.messageService.add({
      severity: 'success',
      summary: 'Succès',
      detail: 'Un stock a été ajouté.'
    });
  }

  showUpdateToast() {
    this.messageService.add({
      severity: 'success',
      summary: 'Succès',
      detail: 'Un stock a été modifié.'
    });
  }

  showDeleteToast() {
    this.messageService.add({
      severity: 'success',
      summary: 'Succès',
      detail: 'Un stock a été supprimé.'
    });
  }

  // ------- Autre ----------------------------------------------------

  convertToString(stock_id: number): string {
    return stock_id.toString();
  }
}
