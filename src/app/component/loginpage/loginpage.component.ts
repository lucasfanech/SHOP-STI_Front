import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { NgIf } from '@angular/common';

import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { ScanService } from '../../services/scan.service';
import { ScanSocketService } from '../../services/scan-socket.service';
import { AuthAppService } from '../../services/auth-app.service';
import { UserService } from '../../services/user.service';
import { firstValueFrom, Subscription } from 'rxjs';

import jsQR from 'jsqr';

@Component({
  selector: 'app-loginpage',
  standalone: true,
  templateUrl: './loginpage.component.html',
  styleUrls: ['./loginpage.component.css'],
  imports: [NgIf, ToastModule],
  providers: [MessageService]
})
export class LoginpageComponent implements OnInit, OnDestroy {

  private scanSubscription?: Subscription;
  private isProcessing = false;

  // --------- Login caméra ---------
  cameraLoginVisible = false;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private lastScannedCode: string | null = null;
  private isCameraProcessing = false;

  constructor(
    private scanService: ScanService,
    private scanSocketService: ScanSocketService,
    private authService: AuthAppService,
    private userService: UserService,
    private router: Router,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/scanpage']);
      return;
    }

    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopCameraInternal();
  }

  // --------- Polling badge (lecteur physique) ---------

  private startPolling(): void {
    this.scanSubscription = this.scanSocketService.scan$.subscribe(response => {
      if (this.isProcessing) return;

      console.log('[scan reçu]', response);

      if (response && response.success && response.value) {
        const val = response.value.trim();

        if (val !== '') {
          console.log(`✅ DÉTECTÉ: "${val}"`);

          this.isProcessing = true;
          this.stopPolling();

          this.loginWithBadge(val);
        }
      }
    });
  }

  private stopPolling(): void {
    this.scanSubscription?.unsubscribe();
    this.scanSubscription = undefined;
  }

  // Bouton "Connexion via lecteur badge" : relance proprement
  restartPolling(): void {
    this.isProcessing = false;
    this.stopCameraInternal();
    this.cameraLoginVisible = false;
    this.stopPolling();
    this.startPolling();
  }

  // --------- Login caméra ---------

  openCameraLogin(): void {
    // on arrête le polling pour éviter double lecture
    this.stopPolling();
    this.isProcessing = false;

    this.cameraLoginVisible = true;
    this.lastScannedCode = null;
    this.isCameraProcessing = false;

    setTimeout(() => this.startCamera(), 150);
  }

  closeCameraLogin(): void {
    this.cameraLoginVisible = false;
    this.stopCameraInternal();

    // on peut relancer le polling badge si tu le souhaites
    this.isProcessing = false;
    this.startPolling();
  }

  private async startCamera(): Promise<void> {
    this.videoEl = document.getElementById('login-video') as HTMLVideoElement;
    this.canvasEl = document.getElementById('login-canvas') as HTMLCanvasElement;

    if (!this.videoEl || !this.canvasEl) {
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur caméra',
        detail: 'Impossible de trouver les éléments vidéo/canvas.'
      });
      this.cameraLoginVisible = false;
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
      this.cameraLoginVisible = false;
    }
  }

  private scanFrame(): void {
    if (!this.cameraLoginVisible || !this.videoEl || !this.canvasEl) {
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
      const val = code.data.trim();
      if (val && !this.isCameraProcessing && val !== this.lastScannedCode) {
        console.log('✅ Code caméra détecté :', val);
        this.lastScannedCode = val;
        this.isCameraProcessing = true;

        // on stoppe la caméra le temps de traiter
        this.stopCameraInternal();
        this.cameraLoginVisible = false;

        // réutilise exactement le même flux de login
        this.loginWithBadge(val).finally(() => {
          this.isCameraProcessing = false;
        });

        return; // on ne relance pas immédiatement la frame
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
    this.videoEl = null;
    this.canvasEl = null;
    this.lastScannedCode = null;
    this.isCameraProcessing = false;
  }

  // --------- Login commun (badge / caméra) ---------

  private async loginWithBadge(badgeToken: string): Promise<void> {
    console.log('🔐 Login:', badgeToken);

    try {
      const user = await firstValueFrom(
        this.userService.getUserByBadge(badgeToken)
      );

      if (!user) {
        this.messageService.add({
          severity: 'error',
          summary: 'Badge inconnu',
          detail: `Badge "${badgeToken}" non reconnu`
        });
        this.isProcessing = false;
        // relance le polling badge par défaut
        this.startPolling();
        return;
      }

      this.authService.login({
        id: user.id,
        username: user.username,
        role: user.role
      });

      this.messageService.add({
        severity: 'success',
        summary: 'Connexion réussie',
        detail: `Bonjour, ${user.username}`
      });

      await this.scanService.clearScan();

      setTimeout(() => {
        this.router.navigate(['/scanpage']);
      }, 500);

    } catch (e) {
      console.error('Erreur login:', e);
      this.messageService.add({
        severity: 'error',
        summary: 'Erreur',
        detail: 'Connexion impossible'
      });
      this.isProcessing = false;
      this.startPolling();
    }
  }
}
