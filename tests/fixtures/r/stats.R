#!/usr/bin/env Rscript
#' Roxygen docs are comments: fake <- function() missing()
library(dplyr)
library("stringr")
requireNamespace("tibble", quietly = TRUE)
source("./helpers.R")

trim_price <- function(price, digits = 2, na = c("", "NA")) {
  rounded <- round(price, digits)
  paste0(rounded, "USD")
}

fit_model = function(frame) {
  model <- glm(mpg ~ wt, data = frame)
  return(model)
}

summary_stats <<- function(x) {
  list(mean = mean(x), sd = sd(x))
}

setClass("Account", slots = c(id = "character", balance = "numeric"))
setGeneric("deposit", function(object, amount) standardGeneric("deposit"))
setMethod("deposit",
  signature(object = "Account"),
  function(object, amount) {
    object@balance <- object@balance + amount
    object
  })

Wallet <- R6Class("Wallet",
  public = list(
    balance = 0,
    initialize = function(start = 0) {
      self$balance <- start
    },
    deposit = function(amount) {
      self$balance <- self$balance + amount
      invisible(self)
    }
  )
)

run_report <- function(path = "/api/report") {
  rows <- read.csv(path, stringsAsFactors = FALSE)
  trimmed <- trim_price(rows$price)
  dplyr::mutate(trimmed, currency = "EUR") # mutate( hidden() in comment
  message("total: ", sum(rows$total, na.rm = TRUE))
  str_detect(trimmed, "^\\d+")
}
