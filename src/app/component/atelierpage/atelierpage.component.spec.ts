import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AtelierpageComponent } from './atelierpage.component';

describe('AtelierpageComponent', () => {
  let component: AtelierpageComponent;
  let fixture: ComponentFixture<AtelierpageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AtelierpageComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(AtelierpageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
