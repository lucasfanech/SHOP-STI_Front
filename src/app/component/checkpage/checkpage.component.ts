import {Component, OnInit} from '@angular/core';
import {CheckService} from "../../services/check.service";
import {NgForOf} from "@angular/common";
import {FormsModule, ReactiveFormsModule} from "@angular/forms";
import {CarouselModule} from "primeng/carousel";
import {TagModule} from "primeng/tag";
import {ButtonModule} from "primeng/button";
import {DialogModule} from "primeng/dialog";
import {ToastModule} from "primeng/toast";
import {MessageService} from "primeng/api";

@Component({
  selector: 'app-checkpage',
  standalone: true,
  imports: [
    NgForOf,
    ReactiveFormsModule,
    FormsModule,
    CarouselModule,
    TagModule,
    ButtonModule,
    DialogModule,
    ToastModule
  ],
  templateUrl: './checkpage.component.html',
  providers: [MessageService],
  styleUrl: './checkpage.component.css'
})
export class CheckpageComponent implements OnInit{

  stocksArray: any[] = [];

  check: any = {
    id: '',
    date: '',
    status: '',
    user: {
      id: '',
    },
    stock: {
      id: '',
    },
    comment: '',
  };

  stock: any = {
    id: '',
  }

  scan: any = {
    badge: '',
  }

  user: any = {
    id: '',
    username: '',
    token: '',
  }

  users: any[] = [];

  responsiveOptions: any[] | undefined;

  constructor(protected checkService: CheckService, private messageService: MessageService) {}

  ngOnInit(){
    this.responsiveOptions = [
      {
        breakpoint: '1400px',
        numVisible: 3,
        numScroll: 3
      },
      {
        breakpoint: '1220px',
        numVisible: 2,
        numScroll: 2
      },
      {
        breakpoint: '1100px',
        numVisible: 1,
        numScroll: 1
      }
    ];
    this.checkService.refreshStocks();
    this.stocksArray = this.checkService.getStocks();
  }

  async detectBadge() {
    this.users = this.checkService.getUsers();
    let badgeExist = false;

    this.users.forEach((user: any) => {
      if(user.token === this.check.badge){
        this.user = user;
        console.log(this.user);
        this.showFindToast();
        badgeExist = true;
      }
    });
    if(!badgeExist){
      this.showErrorToast();
      return;
    }

    try {
      await this.checkService.refreshData();
      this.updateStocks();
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }


  async setStatus(status: boolean){
    this.check.status = status;
    // vérifier si l'utilisateur est connecté
    if(this.user.username === ''){
      this.showErrorToast();
      return;
    }
    // get date
    let date = new Date();
    // serialize date as java Date
    this.check.date = date.toISOString();
    this.check.user.id = this.user.id;
    this.check.stock.id = this.stock.id;

    try {
      await this.checkService.createCheck(this.check);
      this.showAddToast();
      await this.checkService.refreshData(); // Attendre que les données soient rafraîchies
      this.updateStocks();
    } catch (error) {
      console.error('Error adding check:', error);
    }

    this.check.id = '';
    this.check.stock.id = '';
    this.check.user.id = '';
    this.check.comment = '';
    this.check.status = '';
    this.check.date = '';
  }

  async updateStocks() {
    await this.checkService.refreshStocks();
    this.stocksArray = this.checkService.getStocks();
  }


  disconnect(){
    this.user = {
      username: '',
      token: '',
    }
  }

  showAddToast(){
    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Vous avez réalisé un contrôle sur un produit' });
  }

  showFindToast(){
    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Badge reconnu. Bonjour ' + this.user.username });
  }

  showErrorToast(){
    this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Badge non reconnu' });
  }


}
