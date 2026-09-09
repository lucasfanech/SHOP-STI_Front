import { Injectable } from '@angular/core';
import { Client, IMessage } from '@stomp/stompjs';
import { Observable, Subject } from 'rxjs';
import { ScanResponse } from './scan.service';

/**
 * Connexion WebSocket unique (STOMP, natif — sans SockJS) partagée par
 * toute l'application pour recevoir les scans de la douchette en temps
 * réel.
 *
 * Remplace le polling HTTP que faisait individuellement chaque page
 * (login, scan, check, dépôt) : avant, N pages ouvertes = N boucles
 * setInterval tapant chacune le backend, qui relayait vers le web server
 * du PLC. Maintenant le backend lit le PLC une seule fois (voir
 * PlcScanPollingService côté Spring) et diffuse la valeur ici ; le nombre
 * de pages ouvertes n'a plus d'impact sur la charge de l'automate.
 *
 * Pas de SockJS ici volontairement : sa lib utilise `global` sans garde
 * (typeof), ce qui casse au runtime avec le nouveau builder esbuild
 * d'Angular (plus de polyfill `global` automatique comme avec webpack).
 * Un WebSocket natif suffit, le parc visé est 100% navigateurs modernes.
 */
@Injectable({
  providedIn: 'root'
})
export class ScanSocketService {

  private client: Client;
  private scanSubject = new Subject<ScanResponse>();

  /** Flux des scans détectés par l'automate, poussés en temps réel. */
  readonly scan$: Observable<ScanResponse> = this.scanSubject.asObservable();

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const brokerURL = `${protocol}://${window.location.host}/ws`;

    this.client = new Client({
      brokerURL,
      reconnectDelay: 3000,
      onConnect: () => {
        this.client.subscribe('/topic/scan', (message: IMessage) => {
          try {
            const event = JSON.parse(message.body) as ScanResponse;
            this.scanSubject.next(event);
          } catch (e) {
            console.error('[ScanSocketService] Message WebSocket invalide:', e);
          }
        });
      },
      onStompError: frame => {
        console.error('[ScanSocketService] Erreur STOMP:', frame.headers['message']);
      }
    });

    this.client.activate();
  }
}
