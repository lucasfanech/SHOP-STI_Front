import { Component, EventEmitter, Input, Output, TemplateRef } from '@angular/core';
import { NgClass, NgFor, NgTemplateOutlet } from '@angular/common';

/**
 * Disposition physique des 24 casiers (colonnes de hauteurs différentes,
 * répliquant l'agencement réel du meuble). Partagée par toutes les pages
 * qui affichent la grille (retrait/dépôt, gestion des casiers) pour éviter
 * que ce layout ne soit dupliqué et dérive d'une page à l'autre.
 */
export const LOCKER_COLUMNS: number[][] = [
  [1, 2, 3],
  [4, 5],
  [6, 7, 8],
  [9, 10],
  [11, 12, 13, 14, 15],
  [16, 17, 18],
  [19, 20, 21],
  [22, 23, 24]
];

@Component({
  selector: 'app-locker-grid',
  standalone: true,
  imports: [NgFor, NgClass, NgTemplateOutlet],
  templateUrl: './locker-grid.component.html'
})
export class LockerGridComponent {

  /** Numéros de casiers à afficher. Si omis, les 24 sont affichés. */
  @Input() visibleLockers?: number[];

  /** Contenu de chaque case (couleur d'état + informations affichées), fourni par la page appelante. Reçoit le numéro du casier via `let-num`. */
  @Input({ required: true }) itemTemplate!: TemplateRef<{ $implicit: number }>;

  /** Émis avec le numéro du casier cliqué. */
  @Output() boxClick = new EventEmitter<number>();

  readonly columns = LOCKER_COLUMNS;

  isVisible(num: number): boolean {
    return !this.visibleLockers || this.visibleLockers.includes(num);
  }

  hasVisible(col: number[]): boolean {
    return col.some(num => this.isVisible(num));
  }

  cellHeightClass(colIndex: number): string {
    if (colIndex === 1 || colIndex === 3) return 'h-40 sm:h-44';
    if (colIndex === 4) return 'h-24 sm:h-28';
    return 'h-32 sm:h-36';
  }
}
