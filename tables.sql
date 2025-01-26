-- Adminer 4.8.1 MySQL 5.5.5-10.6.18-MariaDB-0ubuntu0.22.04.1 dump

SET NAMES utf8;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

SET NAMES utf8mb4;

DROP TABLE IF EXISTS `document`;
CREATE TABLE `document` (
  `id` varchar(22) NOT NULL,
  `phone` varchar(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fieldsJson` text NOT NULL,
  `signers` text DEFAULT NULL,
  `fileText` text DEFAULT NULL,
  `fileName` varchar(255) NOT NULL,
  `state` varchar(50) NOT NULL,
  `envelopeId` varchar(50) DEFAULT NULL,
  `createdAt` datetime DEFAULT current_timestamp(),
  `originalFileName` varchar(255) DEFAULT NULL,
  `webhook` varchar(22) DEFAULT NULL,
  `navigator` int(1) DEFAULT NULL,
  `srcId` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `phone` (`phone`),
  KEY `webhook` (`webhook`),
  CONSTRAINT `document_ibfk_1` FOREIGN KEY (`phone`) REFERENCES `user` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `signer`;
CREATE TABLE `signer` (
  `id` varchar(22) NOT NULL,
  `routingOrder` int(3) NOT NULL,
  `document` varchar(22) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `document_routingOrder` (`document`,`routingOrder`),
  CONSTRAINT `signer_ibfk_1` FOREIGN KEY (`document`) REFERENCES `document` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `phone` varchar(15) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `docusignUser` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `docusignAccount` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` varchar(83) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


-- 2025-01-26 18:16:15
