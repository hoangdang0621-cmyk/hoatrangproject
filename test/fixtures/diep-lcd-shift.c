#include <xc.h>
#define _XTAL_FREQ 4000000

void LCD_WAIT(){ __delay_us(100); }
void LCD_CMD(unsigned char c){ RE0=0; PORTD=c; RE1=1; RE1=0; LCD_WAIT(); }
void LCD_DATA(unsigned char c){ RE0=1; PORTD=c; RE1=1; RE1=0; LCD_WAIT(); }
void LCD_STR(const char *s){ while(*s) LCD_DATA(*s++); }
void LCD_INIT(){ LCD_CMD(0x38); LCD_CMD(0x0C); LCD_CMD(0x01); LCD_CMD(0x06); }

void main(){
  unsigned char i;
  TRISB=0; TRISD=0; TRISE=0;
  RB1=0;
  LCD_INIT();

  LCD_STR("0123456789ABCDEF");
  LCD_CMD(0xC0);
  LCD_STR("SCROLL 0x18");
  __delay_ms(1000);
  __delay_ms(1000);

  // PHA 1: shift trai 0x18, 16 lan, moi lan 1 giay
  for(i=0; i<16; i++){
    LCD_CMD(0x18);
    RB1=!RB1;
    __delay_ms(1000);
  }

  // PHA 2: shift phai 0x1C, 16 lan, moi lan 1 giay
  for(i=0; i<16; i++){
    LCD_CMD(0x1C);
    RB1=!RB1;
    __delay_ms(1000);
  }

  LCD_CMD(0x01);
  LCD_STR("SHIFT DONE");
  LCD_CMD(0xC0);
  LCD_STR("0x18 + 0x1C");
  while(1){
    RB1=!RB1;
    __delay_ms(1000);
  }
}
