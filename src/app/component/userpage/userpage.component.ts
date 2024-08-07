import {Component, OnInit} from '@angular/core';
import {UserService} from "../../services/user.service";
import {NgForOf} from "@angular/common";
import {FormsModule, ReactiveFormsModule} from "@angular/forms";
import {CarouselModule} from "primeng/carousel";
import {TagModule} from "primeng/tag";
import {ButtonModule} from "primeng/button";
import {DialogModule} from "primeng/dialog";
import {ToastModule} from "primeng/toast";
import {MessageService} from "primeng/api";
import {faKey, faPeopleGroup, faUser} from "@fortawesome/free-solid-svg-icons";
import {FaIconComponent} from "@fortawesome/angular-fontawesome";

@Component({
  selector: 'app-userpage',
  standalone: true,
  imports: [
    NgForOf,
    ReactiveFormsModule,
    FormsModule,
    CarouselModule,
    TagModule,
    ButtonModule,
    DialogModule,
    ToastModule,
    FaIconComponent
  ],
  templateUrl: './userpage.component.html',
  providers: [MessageService],
  styleUrl: './userpage.component.css'
})
export class UserpageComponent implements OnInit{
  user: any = {
    username: '',
    password: '',
    token: '',
    role: '',
  }

  selectedUser: any = {
    username: '',
    password: '',
    token: '',
    role: '',
  }

  dialog1Visible: boolean = false;
  dialog2Visible: boolean = false;

  responsiveOptions: any[] | undefined;

  constructor(protected userService: UserService, private messageService: MessageService) {}

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

    this.userService.refreshUsers();
  }

  addUser() {
    if(this.user.username.trim().length === 0 || this.user.password.trim().length === 0 || this.user.token.trim().length === 0 || this.user.role.trim().length === 0){
      this.showMissingFieldsToast();
      return;
    }
    this.userService.addUser(this.user);
    this.showAddToast();

    // reset the user
    this.user = {
      username: '',
      password: '',
      token: '',
      role: '',
    }
  }

  updateUser() {
    if(this.selectedUser.username.trim().length === 0 || this.selectedUser.token.trim().length === 0 || this.selectedUser.role.trim().length === 0){
      this.showMissingFieldsToast();
      return;
    }

    this.userService.updateUser(this.selectedUser);
    this.showUpdateToast();

    this.selectedUser = {
      username: '',
      password: '',
      token: '',
      role: '',
    }

    this.hideDialog();
  }


  showDialog(user: any, dialogNumber: number) {
    if(dialogNumber === 1){
      this.dialog1Visible = true;
    } else {
      this.dialog2Visible = true;
    }
    // copy the user to selectedUser
    this.selectedUser = {...user};
  }

  hideDialog() {
    this.dialog1Visible = false;
    this.dialog2Visible = false;
  }

  showAddToast(){
    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Un utilisateur a été ajouté' });
  }

  showUpdateToast(){
    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Un utilisateur a été modifié' });
  }

  showDeleteToast(){
    this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Un utilisateur a été supprimé' });
  }

  showMissingFieldsToast() {
    this.messageService.add({severity: 'error', summary: 'Error', detail: 'Veuillez remplir tous les champs'});
  }

  protected readonly faKey = faKey;
  protected readonly faUser = faUser;
  protected readonly faPeopleGroup = faPeopleGroup;
}
