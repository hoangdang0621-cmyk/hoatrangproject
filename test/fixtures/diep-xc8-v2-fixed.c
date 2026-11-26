#include <xc.h>
#include <stdint.h>
#include <string.h>

// Cau hinh PIC16F877A
#pragma config FOSC = HS
#pragma config WDTE = OFF
#pragma config PWRTE = ON
#pragma config BOREN = ON
#pragma config LVP = OFF
#pragma config CPD = OFF
#pragma config WRT = OFF
#pragma config CP = OFF

#define _XTAL_FREQ 20000000

// Dinh nghia cac chan LCD va LED
#define LCD_RS RE0
#define LCD_EN RE1
#define LCD_DATA PORTD
#define LED RB1

// Gui xung cho phep LCD
void LCD_Enable(void)
{
    LCD_EN = 1;
    __delay_us(5);
    LCD_EN = 0;
    __delay_us(50);
}

// Gui lenh dieu khien LCD
void LCD_Command(unsigned char cmd)
{
    LCD_RS = 0;
    LCD_DATA = cmd;
    LCD_Enable();
    __delay_ms(2);
}

// Gui mot ky tu ra LCD
void LCD_Char(unsigned char data)
{
    LCD_RS = 1;
    LCD_DATA = data;
    LCD_Enable();
}

// Khoi tao LCD che do 8-bit
void LCD_Init(void)
{
    ADCON1 = 0x06;

    TRISD = 0x00;
    TRISE = 0x00;
    TRISBbits.TRISB1 = 0;

    PORTD = 0x00;
    PORTE = 0x00;
    LED = 0;

    __delay_ms(40);

    LCD_Command(0x38);
    __delay_ms(5);

    LCD_Command(0x38);
    __delay_us(200);

    LCD_Command(0x38);
    LCD_Command(0x0C);
    LCD_Command(0x06);
    LCD_Command(0x01);

    __delay_ms(2);
}

// Dua con tro den vi tri hang, cot
void LCD_SetCursor(unsigned char row,
                   unsigned char col)
{
    if (row == 1)
        LCD_Command(0x80 + col);
    else
        LCD_Command(0xC0 + col);
}

// Hien thi chuoi ky tu
void LCD_String(const char *str)
{
    while (*str)
    {
        LCD_Char(*str++);
    }
}

// Chuong trinh chinh
void main(void)
{
    const char text[] = "                cong hoa xa hoi chu nghia viet nam                ";

    unsigned char i, j;
    const char title[] = "    VIET NAM    ";
    unsigned char len = 66;

    LCD_Init();

    // Hien thi dong chu co dinh tai hang 1
    LCD_SetCursor(1, 0);
    LCD_String(title);

    while (1)
    {
        // Dich chu tu phai sang trai
        for (i = 0; i <= len - 16; i++)
        {
            LCD_SetCursor(2, 0);

            for (j = 0; j < 16; j++)
            {
                LCD_Char(text[i + j]);
            }

            // Dao trang thai LED
            LED = !LED;

            // Toc do chay chu
            __delay_ms(250);
        }
    }
}
