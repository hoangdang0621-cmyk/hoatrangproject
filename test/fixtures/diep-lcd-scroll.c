#include <xc.h>
#include <stdint.h>

#define _XTAL_FREQ 20000000

#pragma config FOSC = HS
#pragma config WDTE = OFF
#pragma config PWRTE = ON
#pragma config BOREN = ON
#pragma config LVP = OFF
#pragma config CPD = OFF
#pragma config WRT = OFF
#pragma config CP = OFF

#define LCD_RS   PORTEbits.RE0
#define LCD_EN   PORTEbits.RE1
#define LCD_DATA PORTD
#define LED      PORTBbits.RB1

// Ky tu D co gach ngang: Đ
const unsigned char char_D[8] = {
    0b01110,
    0b01001,
    0b01001,
    0b11101,
    0b01001,
    0b01001,
    0b01110,
    0b00000
};

// Ky tu e co dau mu va dau nang: ệ
const unsigned char char_e[8] = {
    0b00100,
    0b01010,
    0b00000,
    0b01110,
    0b10001,
    0b11111,
    0b01111,
    0b00100
};

// Tao xung Enable
void LCD_Pulse(void)
{
    LCD_EN = 1;
    __delay_us(2);
    LCD_EN = 0;
    __delay_us(50);
}

// Gui lenh den LCD
void LCD_Command(unsigned char cmd)
{
    LCD_RS = 0;
    LCD_DATA = cmd;
    LCD_Pulse();
    __delay_ms(2);
}

// Gui ky tu den LCD
void LCD_Char(unsigned char data)
{
    LCD_RS = 1;
    LCD_DATA = data;
    LCD_Pulse();
}

// Khoi tao LCD che do 8 bit
void LCD_Init(void)
{
    LCD_RS = 0;
    LCD_EN = 0;

    __delay_ms(40);

    LCD_Command(0x30);
    __delay_ms(5);
    LCD_Command(0x30);
    __delay_us(150);
    LCD_Command(0x30);

    LCD_Command(0x38); // 8 bit, 2 dong
    LCD_Command(0x0C); // Bat LCD, tat con tro
    LCD_Command(0x06); // Tu tang dia chi
    LCD_Command(0x01); // Xoa man hinh
}

// Tao ky tu dac biet trong CGRAM
void LCD_CreateChar(unsigned char location,
                    const unsigned char *pattern)
{
    unsigned char i;

    location &= 0x07;
    LCD_Command(0x40 + location * 8);

    for (i = 0; i < 8; i++)
    {
        LCD_Char(pattern[i]);
    }

    LCD_Command(0x80);
}

// Dat vi tri con tro
void LCD_SetCursor(unsigned char row,
                   unsigned char col)
{
    if (row == 0)
        LCD_Command(0x80 + col);
    else
        LCD_Command(0xC0 + col);
}

// Chuong trinh chinh
void main(void)
{
    int pos, index;
    unsigned char col;

    // Chuoi "Hello Diep" voi ky tu tuy chinh
    const unsigned char message[] = {
        'H', 'e', 'l', 'l', 'o', ' ',
         0,  'i',  1,  'p'
    };

    ADCON1 = 0x06; // Cau hinh cac chan analog thanh digital
    TRISE = 0x00;
    TRISD = 0x00;
    TRISBbits.TRISB1 = 0;

    PORTD = 0x00;
    PORTE = 0x00;
    LED = 0;

    LCD_Init();

    LCD_CreateChar(0, char_D);
    LCD_CreateChar(1, char_e);

    while (1)
    {
        // Dich chu tu phai sang trai
        for (pos = 15; pos >= -10; pos--)
        {
            LCD_SetCursor(0, 0);

            for (col = 0; col < 16; col++)
            {
                index = (int)col - pos;

                if (index >= 0 && index < 10)
                    LCD_Char(message[index]);
                else
                    LCD_Char(' ');
            }

            LED = !LED;

            __delay_ms(250);
        }
    }
}
