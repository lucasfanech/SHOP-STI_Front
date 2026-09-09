import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private userArray: any[] = [];

  constructor(private httpClient: HttpClient) {
    this.refreshUsers();
  }

  // ── Rafraîchir l'info d'un utilisateur ─────────────────────────────────────

  /**
   * Charge les infos d'un user (api/users/info/{id}) et les applique à l'objet.
   * Retourne un Observable pour pouvoir être utilisé dans forkJoin.
   */
  refreshUser(user: any): Observable<any> {
    return this.httpClient
      .get(`api/users/info/${user.id}`, { responseType: 'text' })
      .pipe(
        tap((info: string) => {
          const parts = info.split('|');
          // Traduction du type d'opération en français
          if (parts[0]) {
            parts[0] = parts[0].replace('deposit', 'Dépôt')
              .replace('withdraw', 'Retrait')
              .replace('check', 'Contrôle');
          }
          user.info = parts;
        })
      );
  }

  /**
   * Charge tous les users puis, pour chacun, appelle refreshUser.
   */
  refreshUsers(): void {
    this.httpClient.get<any[]>('api/users').subscribe(users => {
      this.userArray = users || [];

      if (this.userArray.length === 0) {
        return;
      }

      const requests = this.userArray.map(user => this.refreshUser(user));

      forkJoin(requests).subscribe({
        next: () => {
          // Tous les users ont été rafraîchis
        },
        error: err => {
          console.error('Erreur lors du rafraîchissement des infos users :', err);
        }
      });
    });
  }

  getAllUsers(): any[] {
    return this.userArray;
  }

  // ── Mise à jour d'une info utilisateur en local + back ────────────────────

  /**
   * Met à jour l'info d'un user dans le tableau local et renvoie l'objet mis à jour.
   * (Si tu veux que ça aille aussi au back, passe par updateUser.)
   */
  updateUserInfo(userId: number, userInfo: string): void {
    this.userArray = this.userArray.map(user => {
      if (user.id === userId) {
        user.info = userInfo;
      }
      return user;
    });
  }

  // ── CRUD utilisateur ───────────────────────────────────────────────────────

  addUser(userSent: any): void {
    const user = {
      username: userSent.username,
      password: userSent.password,
      token: userSent.token,
      role: userSent.role
    };

    this.httpClient.post('api/users', user).subscribe(() => {
      this.refreshUsers();
    });
  }

  updateUser(userSent: any): void {
    const user = {
      id: userSent.id,
      username: userSent.username,
      password: userSent.password,
      token: userSent.token,
      role: userSent.role
    };

    this.httpClient.post('api/users', user).subscribe((userReceived: any) => {
      // Mise à jour dans le cache
      this.userArray = this.userArray.map(u =>
        u.id === userReceived.id ? userReceived : u
      );

      // Recharger ses infos d'activité
      const updated = this.userArray.find(u => u.id === userReceived.id);
      if (updated) {
        this.refreshUser(updated).subscribe();
      }
    });
  }

  removeUser(id: number): void {
    this.userArray = this.userArray.filter(user => user.id !== id);
    this.httpClient.delete('api/users/' + id).subscribe(() => {
      this.refreshUsers();
    });
  }

  // ── Recherche par badge ────────────────────────────────────────────────────

  getUserByBadge(badgeToken: string): Observable<any | null> {
    // Si le cache est vide, on recharge puis on filtre
    if (!this.userArray || this.userArray.length === 0) {
      return this.httpClient.get<any[]>('api/users').pipe(
        map(users => {
          this.userArray = users || [];
          return this.userArray.find(u => u.token === badgeToken) ?? null;
        })
      );
    }

    const user = this.userArray.find(u => u.token === badgeToken) ?? null;
    return of(user);
  }
}
