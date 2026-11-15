<script setup lang="ts">
// Продукти прийому їжі з грамовкою в конструкторі меню: «Гречка — 60 г».
// Додаються з довідника (вкладка «Продукти» в конструкторі) або вручну.
import { nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { PRODUCTS_MAX, type MealProduct } from '@/lib/meals'
import { customProduct, parseQty, PRODUCT_UNITS } from '@/lib/products'

const model = defineModel<MealProduct[]>({ required: true })

const qtyInputs = ref<HTMLInputElement[]>([])
const nameInputs = ref<HTMLInputElement[]>([])

const valueOf = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value

function patch(index: number, change: Partial<MealProduct>) {
  model.value = model.value.map((p, i) => (i === index ? { ...p, ...change } : p))
}

const onName = (index: number, e: Event) => patch(index, { name: valueOf(e) })
const onQty = (index: number, e: Event) => patch(index, { qty: parseQty(valueOf(e)) })
const onUnit = (index: number, e: Event) => patch(index, { unit: valueOf(e) || null })

// одиниця з довідника може бути незвичною («ст.л.») — лишаємо її в списку
const unitsFor = (p: MealProduct) => (p.unit && !(PRODUCT_UNITS as readonly string[]).includes(p.unit) ? [p.unit, ...PRODUCT_UNITS] : PRODUCT_UNITS)

const remove = (index: number) => (model.value = model.value.filter((_, i) => i !== index))

async function focusQty(index: number) {
  await nextTick()
  qtyInputs.value[index]?.focus()
  qtyInputs.value[index]?.select()
}

async function addCustom() {
  if (model.value.length >= PRODUCTS_MAX) return
  model.value = [...model.value, customProduct()]
  await nextTick()
  nameInputs.value[model.value.length - 1]?.focus()
}

defineExpose({ focusQty })
</script>

<template lang="pug">
section.meal-products(aria-label='Продукти з грамовкою')
  .meal-products__head
    span.meal-products__title Продукти з грамовкою
    button.btn.btn--ghost.btn--sm(type='button' :disabled='model.length >= PRODUCTS_MAX' @click='addCustom')
      AppIcon(name='plus' :size='16')
      | Свій продукт
  p.meal-products__empty(v-if='!model.length') Гречка, рис, овочі, фрукти, олія — оберіть у вкладці «Продукти» й вкажіть вагу.
  ul.meal-products__list(v-else)
    li.meal-products__row(v-for='(p, i) in model' :key='i')
      input.meal-products__name(
        ref='nameInputs'
        :value='p.name'
        type='text'
        maxlength='60'
        placeholder='Продукт'
        aria-label='Назва продукту'
        @input='onName(i, $event)'
      )
      .meal-products__amount
        input.meal-products__qty(
          ref='qtyInputs'
          :value='p.qty ?? ""'
          type='text'
          inputmode='decimal'
          placeholder='—'
          :aria-label='`Кількість: ${p.name || "продукт"}`'
          @input='onQty(i, $event)'
        )
        select.meal-products__unit(:value='p.unit ?? ""' aria-label='Одиниця' @change='onUnit(i, $event)')
          option(v-for='u in unitsFor(p)' :key='u' :value='u') {{ u }}
      button.meal-products__remove(type='button' :aria-label='`Прибрати: ${p.name || "продукт"}`' @click='remove(i)')
        AppIcon(name='close' :size='16')
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.meal-products {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;

    .btn {
      gap: 4px;
    }
  }

  &__title {
    color: $text-nav;
    font-size: 14px;
  }

  &__empty {
    padding: 12px;
    border: 1px dashed $line-green;
    border-radius: $radius-item;
    color: $text-muted;
    font-size: 13px;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__name,
  &__qty,
  &__unit {
    min-height: 40px;
    border: 1px solid $line-green;
    border-radius: 10px;
    background: $bg;
    color: $text;
    font: inherit;
    font-size: 14px;

    &:focus {
      border-color: $accent;
      outline: none;
      box-shadow: 0 0 0 3px $bg-active;
    }
  }

  &__name {
    flex: 1 1 auto;
    min-width: 0;
    padding: 8px 10px;
  }

  &__amount {
    display: flex;
    flex: none;
    gap: 4px;
  }

  &__qty {
    width: 64px;
    padding: 8px;
    text-align: right;
  }

  &__unit {
    width: 64px;
    padding: 8px 4px;
  }

  &__remove {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: $text-faint;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: $bg-soft;
      color: $text;
      outline: none;
    }
  }
}
</style>
