<script setup lang="ts">
import { useAuth } from '@/stores/auth'
import LabFiles from '@/components/LabFiles.vue'

const auth = useAuth()
const clientId = auth.account!.clientId!
</script>

<template lang="pug">
main.page
  .page-head
    div
      .page-head__sub Бачите лише ви та Анастасія
      h1.page-head__title Мої аналізи
  section.card
    LabFiles(:client-id='clientId' can-upload)
</template>
