// Tarkov-style grid overlay + rotating 3D inspect viewport.

import * as THREE from 'three';
import { INV_COLS, INV_ROWS, MAX_CARRY_WEIGHT } from '../core/constants';
import { buildItemMesh } from '../items/ItemMeshes';
import { Inventory } from '../items/Inventory';
import { ItemInstance } from '../items/Items';
import { itemIcon } from './icons';

const CELL_PX = 74;
const GAP_PX = 4;

export class InventoryUI {
  open = false;

  /** called when the player drops an item via the grid (right-click) */
  onDrop: ((item: ItemInstance) => void) | null = null;

  private screen = document.getElementById('inventory-screen')!;
  private panel = document.getElementById('inventory-panel')!;
  private grid = document.getElementById('inventory-grid')!;
  private weight = document.getElementById('inventory-weight')!;
  private inspectCanvas = document.getElementById('inspect-canvas') as HTMLCanvasElement;
  private inspectLabel = document.getElementById('inspect-label')!;

  // drag-an-item-out-of-the-bag-to-drop-it state
  private dragItem: ItemInstance | null = null;
  private dragSourceEl: HTMLElement | null = null;
  private dragGhost: HTMLElement | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragActive = false;
  private suppressClick = false;

  private inventory: Inventory;
  private inspectRenderer: THREE.WebGLRenderer | null = null;
  private inspectScene: THREE.Scene | null = null;
  private inspectCamera: THREE.PerspectiveCamera | null = null;
  private inspectMesh: THREE.Group | null = null;
  private inspectRaf = 0;

  constructor(inventory: Inventory) {
    this.inventory = inventory;
    inventory.onChanged = () => { if (this.open) this.render(); };
    document.addEventListener('mousemove', (e) => this.onDragMove(e));
    document.addEventListener('mouseup', (e) => this.onDragEnd(e));
  }

  toggle(): boolean {
    this.setOpen(!this.open);
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.screen.classList.toggle('hidden', !open);
    if (open) {
      this.render();
    } else {
      this.cancelDrag();
      this.stopInspect();
    }
  }

  private render(): void {
    this.stopInspect();
    this.grid.innerHTML = '';
    // background cells
    for (let i = 0; i < INV_COLS * INV_ROWS; i++) {
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      this.grid.appendChild(cell);
    }
    // item tiles (absolutely positioned over the grid)
    this.grid.style.position = 'relative';
    for (const placed of this.inventory.items) {
      const { item, col, row } = placed;
      const el = document.createElement('div');
      el.className = 'inv-item' + (this.inventory.equipped === item ? ' equipped' : '');
      el.style.position = 'absolute';
      el.style.left = `${col * (CELL_PX + GAP_PX)}px`;
      el.style.top = `${row * (CELL_PX + GAP_PX)}px`;
      el.style.width = `${item.def.gridW * CELL_PX + (item.def.gridW - 1) * GAP_PX}px`;
      el.style.height = `${item.def.gridH * CELL_PX + (item.def.gridH - 1) * GAP_PX}px`;

      const icon = document.createElement('div');
      icon.className = 'item-icon';
      icon.innerHTML = itemIcon(item.def.id);
      el.appendChild(icon);

      const label = document.createElement('div');
      label.textContent = item.def.id === 'pistol' ? `${item.def.name} (${item.ammo})` : item.def.name;
      el.appendChild(label);

      if (isFinite(item.def.durability) && item.def.durability > 1) {
        const bar = document.createElement('div');
        bar.className = 'item-durability';
        const fill = document.createElement('div');
        fill.style.width = `${(item.durability / item.def.durability) * 100}%`;
        bar.appendChild(fill);
        el.appendChild(bar);
      }

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.suppressClick = false;
        this.dragItem = item;
        this.dragSourceEl = el;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragActive = false;
      });
      el.addEventListener('click', () => {
        if (this.suppressClick) {
          this.suppressClick = false;
          return;
        }
        this.inventory.equip(item);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onDrop?.(item);
      });
      el.addEventListener('mouseenter', () => this.inspect(item));
      el.addEventListener('mouseleave', () => this.stopInspect());
      this.grid.appendChild(el);
    }

    const w = this.inventory.totalWeight();
    this.weight.textContent = `WEIGHT ${w} / ${MAX_CARRY_WEIGHT}`;
    this.weight.classList.toggle('full', w >= MAX_CARRY_WEIGHT);
  }

  // -------------------------------------------- drag out of the bag = drop

  private onDragMove(e: MouseEvent): void {
    if (!this.dragItem) return;
    if (!this.dragActive) {
      if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) < 6) return;
      this.dragActive = true;
      this.dragGhost = document.createElement('div');
      this.dragGhost.className = 'inv-drag-ghost';
      this.dragGhost.innerHTML = itemIcon(this.dragItem.def.id);
      this.dragGhost.appendChild(document.createTextNode(this.dragItem.def.name));
      document.body.appendChild(this.dragGhost);
      this.dragSourceEl?.classList.add('dragging');
    }
    this.dragGhost!.style.left = `${e.clientX + 12}px`;
    this.dragGhost!.style.top = `${e.clientY + 8}px`;
    this.dragGhost!.classList.toggle('droppable', this.isOutsidePanel(e));
  }

  private onDragEnd(e: MouseEvent): void {
    if (!this.dragItem) return;
    const item = this.dragItem;
    const wasDrag = this.dragActive;
    this.cancelDrag();
    if (!wasDrag) return; // plain click — the click listener equips
    this.suppressClick = true; // a drag happened; swallow the click that follows
    if (this.isOutsidePanel(e)) this.onDrop?.(item);
  }

  private cancelDrag(): void {
    this.dragItem = null;
    this.dragActive = false;
    this.dragSourceEl?.classList.remove('dragging');
    this.dragSourceEl = null;
    this.dragGhost?.remove();
    this.dragGhost = null;
  }

  private isOutsidePanel(e: MouseEvent): boolean {
    const r = this.panel.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  // -------------------------------------------------- 3D inspect viewport

  private inspect(item: ItemInstance): void {
    this.stopInspect();
    this.inspectCanvas.classList.remove('hidden');
    this.inspectLabel.classList.remove('hidden');
    this.inspectLabel.textContent = `${item.def.name} — ${item.def.description}`;

    if (!this.inspectRenderer) {
      this.inspectRenderer = new THREE.WebGLRenderer({ canvas: this.inspectCanvas, antialias: true, alpha: true });
      this.inspectRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      this.inspectScene = new THREE.Scene();
      this.inspectCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 10);
      this.inspectCamera.position.set(0, 0.12, 0.7);
      this.inspectCamera.lookAt(0, 0, 0);
      const key = new THREE.DirectionalLight(0xfff2cc, 2.5);
      key.position.set(1, 1.5, 1);
      this.inspectScene.add(key);
      this.inspectScene.add(new THREE.AmbientLight(0x808a99, 1.2));
    }

    this.inspectMesh = buildItemMesh(item.def.id);
    // normalise size so every item fills the viewport nicely
    const box = new THREE.Box3().setFromObject(this.inspectMesh);
    const size = box.getSize(new THREE.Vector3()).length();
    this.inspectMesh.scale.setScalar(0.55 / Math.max(0.05, size));
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(this.inspectMesh.scale.x);
    this.inspectMesh.position.sub(center);
    this.inspectScene!.add(this.inspectMesh);

    const animate = () => {
      if (!this.inspectMesh) return;
      this.inspectMesh.rotation.y += 0.014;
      this.inspectMesh.rotation.x = 0.25;
      this.inspectRenderer!.render(this.inspectScene!, this.inspectCamera!);
      this.inspectRaf = requestAnimationFrame(animate);
    };
    animate();
  }

  private stopInspect(): void {
    cancelAnimationFrame(this.inspectRaf);
    if (this.inspectMesh && this.inspectScene) {
      this.inspectScene.remove(this.inspectMesh);
      this.inspectMesh.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      this.inspectMesh = null;
    }
    this.inspectCanvas.classList.add('hidden');
    this.inspectLabel.classList.add('hidden');
  }
}
